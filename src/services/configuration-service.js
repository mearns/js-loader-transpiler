import Promise from 'bluebird';
import _ from 'lodash';
import R from 'ramda';
import walk from 'walk';
import {wrapError} from './error-utils';
import path from 'path';
import * as mzfs from 'mz/fs';
import crypto from 'crypto';
import {OutputGenerator} from './output-generator';

export class Configuration {

    constructor(options, {sourceDirs, context, output}) {
        this._options = options;
        this._sourceDirs = sourceDirs;
        this._context = context;
        this._output = output;
        this._handlers = (output.handlers || []).map((handler) => new Handler(options, output.path, handler));
    }

    /**
     * Returns a Promise for an array of `OutputGenerators` produced by this configuration.
     */
    getOutputGeneratorsForConfig() {
        return Promise.all(this.visitSources(this.getOutputGeneratorsForSource.bind(this)))
            .then((listsOfGenerators) => _.flatten(listsOfGenerators));
    }

    /**
     * Returns a Promise for an array of `OutputGenerators` produced by this configuration
     * for the given source object.
     */
    getOutputGeneratorsForSource(source) {
        return Promise.all(this.visitHandlers((handler) => {
            return handler.getOutputGeneratorsForSource(source);
        }))
            .then((listsOfGenerators) => _.flatten(listsOfGenerators));
    }

    /**
     * Apply the given transformation for every handler in this configuration
     * and return a Promise for an array of the results, in the same order as the
     * handlers are listed in this object.
     *
     * Note that although the results are returned in corresponding order, the transformation
     * is applied asynchronously to the handlers and the order in which it is _applied_ is
     * _not_ guaranteed.
     *
     * The transform is invoked with the handler as the only argument.
     */
    visitHandlers(handlerTransformation) {
        const method = Promise.method(handlerTransformation);
        return Promise.all(this._handlers.map(method));
    }

    /**
     * Scan all source dirs in this configuration for sources, and apply the given transformation
     * to them, returning a collection of the results (order not gauranteed).
     *
     * The `sourceTransformation` will be invoked with the results of `_createSourceFileObject`
     * for each source.
     */
    visitSources(sourceTransformation) {
        return Promise.all(this._sourceDirs.map((sourceDir) => this.visitSourcesInDir(sourceDir, sourceTransformation)))
            .then((results) => _.flatten(results));
    }

    _createSourceFileObject(sourceDir, root, stats) {
        const absolutePath = path.join(root, stats.name);
        return new SourceFile(sourceDir, path.relative(sourceDir, absolutePath));
    }

    /**
     * Given a directory, recursively scan for all sources and apply the given transformation to each source,
     * returning a promise for an array of the results (in no particular order).
     */
    visitSourcesInDir(sourceDir, sourceTransformation) {
        return new Promise((fulfill, reject) => {
            const method = Promise.method(sourceTransformation);
            const walker = walk.walk(sourceDir);
            const results = [];
            let failed = false;

            walker.on('file', (root, stats, next) => {
                if (!failed) {
                    results.push(method(this._createSourceFileObject(sourceDir, root, stats)));
                    next();
                }
            });

            walker.on('errors', (root, statsArray, next) => {
                reject(wrapError('Error occurred walking file system', statsArray.error));
                failed = true;
                next();
            });

            walker.on('end', () => {
                if (!failed) {
                    fulfill(Promise.all(results));
                }
            });
        });
    }

}

class Condition {
    constructor(condition) {
        this.test = () => true;
        this.include = [];
        this.exclude = [];

        switch (typeof condition) {
            case 'boolean':
                this.test = () => Promise.resolve(condition);
                break;

            case 'string':
                this.test = (absPath) => Promise.resolve(absPath.startsWith(condition));
                break;

            case 'function':
                this.test = (...args) => Promise.method(condition(...args)).then(Boolean);
                break;

            case 'object':
                if (condition instanceof RegExp) {
                    this.test = (absPath) => Promise.resolve(condition.test(absPath));
                }
                else if (condition instanceof Condition) {
                    this.test = condition.satisfiedBy;
                }
                else if (condition instanceof Array) {
                    this.include = condition
                        .map(Condition.cast)
                        .map((c) => c.satisfiedBy);
                }
                else {
                    const {test, include, exclude, __strict__ = true} = condition;
                    if (__strict__) {
                        const removeKnownKeys = R.without(['test', 'include', 'exclude', '__strict__']);
                        const unknownKeys = removeKnownKeys(Object.keys(condition));
                        if (unknownKeys.length) {
                            throw new Error(`Unknown keys in strict condition: ${unknownKeys.join(', ')}`);
                        }
                    }

                    if (!_.isUndefined(test)) {
                        this.test = Condition.cast(test).satisfiedBy;
                    }
                    if (!_.isUndefined(include)) {
                        if (include instanceof Array) {
                            this.include = include.map(Condition.cast).map((c) => c.satisfiedBy);
                        }
                        else {
                            this.include = [Condition.cast(include).satisfiedBy];
                        }
                    }
                    if (!_.isUndefined(exclude)) {
                        if (exclude instanceof Array) {
                            this.exclude = exclude.map(Condition.cast).map((c) => c.satisfiedBy);
                        }
                        else {
                            this.exclude = [Condition.cast(exclude).satisfiedBy];
                        }
                    }
                }
                break;
        }

        this.satisfiedBy = this.satisfiedBy.bind(this);
    }

    satisfiedBy(...args) {
        return Promise.join(
            this.test(...args),
            Promise.all(this.include.map((f) => f())),
            Promise.all(this.exclude.map((f) => f())),
            (test, include, exclude) => {
                return test && include.every(R.identity) && !exclude.some(R.identity);
            });
    }
}
Condition.cast = function (c) {
    // TODO: Pass options, or at least logger, to Conditions, maybe with a factory.
    // The generated functions should log what they're testing, against what.
    if (c instanceof Condition) {
        return c;
    }
    else {
        return new Condition(c);
    }
};

class Handler {
    constructor(options, destDir, handlerDef) {
        this._options = options;
        this._destDir = destDir;
        this._condition = Condition.cast(_.pick(handlerDef, ['test', 'include', 'exclude']));
        this._satisfied = Promise.method(this._condition.satisfiedBy);
        this._getDestination = Promise.method(handlerDef.destination || ((defaultDestination) => defaultDestination));
        this._baseHandlerContext = {
            data: {},
            destDir: this._destDir
        };
    }

    getDefaultDestination({destDir, source}) {
        return path.join(destDir, source.relativePath);
    }

    getOutputGeneratorsForSource(source) {
        // TODO: Fill in handler context.
        const handlerContext = Object.assign({}, this._baseHandlerContext, {
            source,
            resource: source.absolutePath,
            resourcePath: source.absolutePath,
            resourceQuery: ''
        });
        return this._satisfied(source.absolutePath, handlerContext)
            .then((satisfied) => {
                if (satisfied) {
                    return this._getDestination(this.getDefaultDestination(handlerContext), handlerContext)
                        .then((destinationPath) => [destinationPath]);
                }
                else {
                    return [];
                }
            })
            .then((destinationPaths) => {
                return destinationPaths.map((destinationPath) => {
                    return Object.assign(Object.create(new OutputGenerator(this._options, source, destinationPath)), {
                        generateOutput: function () {
                            console.log('Generating output', destinationPath);
                        }
                    });
                });
            });
    }
}

class SourceFile {

    constructor(sourceDir, relativePath, stats) {
        this.relativePath = relativePath;
        this.absolutePath = path.resolve(sourceDir, relativePath);
        this.sourceDir = sourceDir;
        this.size = (stats && stats.size) ? stats.size : null;
        this.content = null;
        this.hash = null;

        this._promiseForContent = null;
        this._promiseForHash = null;
        this._promiseForSize = null;
    }

    getContent() {
        if (this._promiseForContent === null) {
            this._promiseForContent = mzfs.readFile(this.absolutePath)
                .then((content) => {
                    this.content = content;
                    return content;
                });
        }
        return this._promiseForContent;
    }

    getHash() {
        if (this._promiseForHash === null) {
            this._promiseForHash = this.getContent()
                .then((content) => {
                    this.hash = this.hashBuffer(content);
                    return this.hash;
                });
        }
        return this._promiseForHash;
    }

    getSize() {
        if (this._promiseForSize === null) {
            this._promiseForSize = mzfs.stat(this.absolutePath)
                .then((stats) => {
                    this.size = stats.size;
                    return this.size;
                });
        }
        return this._promiseForSize;
    }

    hashBuffer(buffer) {
        const hash = crypto.createHash('sha256');
        hash.update(buffer.toString('utf-8'));
        return hash.digest('hex');
    }
}
