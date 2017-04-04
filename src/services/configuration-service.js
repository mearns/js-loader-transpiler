import Promise from 'bluebird';
import _ from 'lodash';
import R from 'ramda';
import walk from 'walk';
import {wrapError} from './error-utils';
import path from 'path';
import * as mzfs from 'mz/fs';
import crypto from 'crypto';
import {OutputGenerator} from './output-generator';
import resolve from 'resolve';
import mkdirp from 'mkdirp';

const mkdirpAsPromised = Promise.promisify(mkdirp);

require('require-ensure');

export class Configuration {

    constructor(options, {sourceDirs, context, output}) {
        this._options = options;
        this.resolvePath = (input) => path.resolve(this._options.rootDir, input);

        this._sourceDirs = sourceDirs.map(this.resolvePath);
        this._context = this.resolvePath(context);
        options.context = this._context;
        this._outputPath = this.resolvePath(output.path);
        this._handlers = (output.handlers || []).map((handler) => new Handler(options, this._outputPath, handler));
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
        this._useEntries = (handlerDef.use || []).map((useEntry) => new UseEntry(options, useEntry));
        this._forks = (handlerDef.fork || []).map((fork) => new Handler(options, destDir, fork));
    }

    getDefaultDestination({destDir, source}) {
        return path.join(destDir, source.relativePath);
    }

    _getOutputGenerator(source, handlerContext, getOutput) {
        return this._getDestination(this.getDefaultDestination(handlerContext), handlerContext)
            .then((destinationPath) => {
                const baseOutputGenerator = new OutputGenerator(this._options, source, destinationPath);
                return Object.assign(baseOutputGenerator, {
                    generateOutput: () => {
                        return getOutput()
                            .then(({content}) => {
                                return mkdirpAsPromised(path.dirname(destinationPath))
                                    .then(() => Promise.resolve(mzfs.writeFile(destinationPath, content)))
                                    .catch((error) => {
                                        throw wrapError(error,
                                            'Failed trying to write destination file: {messsage}');
                                    });
                            })
                            .tap(() => {
                                this._options.log.info(`Generated ${destinationPath}`);
                            });
                    }
                });
            });
    }

    _getOutputGeneratorsForSource(source, baseHandlerContext, getInput) {
        const handlerContext = Object.assign({}, baseHandlerContext);
        return this._satisfied(source.absolutePath, handlerContext)
            .then((satisfied) => {
                if (satisfied) {
                    const getTransformation = R.memoize(() => {
                        return getInput().then((input) => this.transform(handlerContext, input));
                    });
                    const promiseForBaseGenerators = this._getOutputGenerator(source, handlerContext, getTransformation)
                        .then((gen) => [gen]);

                    const promisesForForkGenerators = this._forks.map((fork) => {
                        return fork._getOutputGeneratorsForSource(source, handlerContext, getTransformation);
                    });

                    const promisesForAllGeneratorLists = [promiseForBaseGenerators, ...promisesForForkGenerators];

                    return Promise.all(promisesForAllGeneratorLists)
                        .then((listOfListsOfPromisesForOutputGenerators) => {
                            return Promise.all(_.flatten(listOfListsOfPromisesForOutputGenerators));
                        });
                }
                else {
                    return [];
                }
            });
    }

    getOutputGeneratorsForSource(source) {
        // TODO: Fill in handler context.
        const baseHandlerContext = Object.assign({}, this._baseHandlerContext, {
            source,
            resource: source.absolutePath,
            resourcePath: source.absolutePath,
            resourceQuery: ''
        });

        const getInput = () => {
            return source.getContentString()
                .then((content) => ({content}));
        };

        return this._getOutputGeneratorsForSource(source, baseHandlerContext, getInput);
    }

    /**
     * Given a handler context and initial input (or promise for initial input), return
     * a promise to transform that input through all the loaders for this handler (not
     * including any forks).
     *
     * @param  {Object} handlerContext The handler context to pass to the loaders
     * @param  {Object} initialInput   An object with a required `content` property
     *                                 containing the String contents to transform,
     *                                 and an optional `value` property containing the
     *                                 value corresponding to the content to pass in
     *                                 to the next loader. Or, this parameter can be
     *                                 a Promise for such an object.
     * @return {Promise<Object>}       A Promise for an object similar to that provided
     *                                 for the `initialInput` parameter, providing the
     *                                 transformed `content` and (possibly) `value`.
     */
    transform(handlerContext, initialInput) {
        return this._useEntries.reduce((promiseForTransformation, useEntry) => {
            return promiseForTransformation.then((input) => {
                return useEntry.transform(input, handlerContext)
                    .catch((error) => {
                        throw wrapError(error, 'Failed trying to transform content: {message}');
                    });
            });
        }, Promise.resolve(initialInput));
    }
}

class UseEntry {
    constructor(options, useEntry) {
        this._options = options;
        if (typeof useEntry === 'object') {
            const {loader, options: _loaderOptions = {}, ident, __strict__ = true} = useEntry;
            if (__strict__) {
                const removeKnownKeys = R.without(['loader', 'options', 'ident', '__strict__']);
                const unknownKeys = removeKnownKeys(Object.keys(useEntry));
                if (unknownKeys.length) {
                    throw new Error(`Unknown keys in strict use entry: ${unknownKeys.join(', ')}`);
                }
            }

            this._loader = Loader.getLoader(options, loader);
            this._loaderOptions = _loaderOptions;
            this._ident = ident;
        }
        else {
            this._loaderOptions = {};
            this._loader = Loader.getLoader(options, useEntry);
            this._ident = null; // TODO: Implement ident.
        }
    }

    transform(input, handlerContext) {
        return this._loader.asPromised()
            .catch((error) => {
                throw wrapError(error, `Error importing loader module for ${this._ident}: {message}`);
            })
            .then((loader) => {
                const {
                    content: inputContent,
                    value: inputValue
                } = input;

                const loaderContext = Object.assign({}, handlerContext, {
                    data: {},
                    options: this._loaderOptions,
                    inputValue
                });

                let fulfill, reject;
                const promise = new Promise((_fulfill, _reject) => {
                    fulfill = _fulfill;
                    reject = _reject;
                });
                function callback(error, newContent) {
                    if (error) {
                        reject(error);
                    }
                    else {
                        fulfill({
                            content: String(newContent),
                            value: loaderContext.value
                        });
                    }
                }
                try {
                    const newContent = loader.bind(loaderContext)(inputContent);
                    if (!_.isUndefined(newContent)) {
                        callback(null, newContent);
                    }
                }
                catch (error) {
                    throw wrapError(error, `Error applying loader ${this._ident}: {message}`);
                }

                return promise;
            });
    }
}

const resolveAsPromised = Promise.promisify(resolve);

function importNamedModule(name, resolveOpts) {
    return resolveAsPromised(name, resolveOpts)
        .then((resolvedModulePath) => {
            return new Promise((fulfill) => {
                require.ensure([resolvedModulePath], (req) => fulfill(req(resolvedModulePath)));
            });
        });
}

class Loader {
    constructor(options, loaderDef) {
        const resolveOpts = {
            // TODO: These
            // package: packageData,
            basedir: options.context
        };

        switch (typeof loaderDef) {
            case 'function':
                this._promiseForLoader = Promise.resolve(loaderDef);
                break;

            case 'string':
                this._promiseForLoader = importNamedModule(loaderDef, resolveOpts)
                    .catch((error) => {
                        throw wrapError(error, `Error attempting to import loader '${loaderDef}': {message}`);
                    });
                break;

            default:
                throw new Error(`Unexpected loader definition: ${loaderDef}`);
        }
    }

    asPromised() {
        return this._promiseForLoader;
    }
}
Loader.getLoader = function (options, loaderDef) {
    return new Loader(options, loaderDef);
};

class SourceFile {

    constructor(sourceDir, relativePath, stats) {
        this.relativePath = relativePath;
        this.absolutePath = path.resolve(sourceDir, relativePath);
        this.sourceDir = sourceDir;
        this.size = (stats && stats.size) ? stats.size : null;
        this.content = null;
        this.contentString = null;
        this.hash = null;

        this._promiseForContent = null;
        this._promiseForContentString = null;
        this._promiseForHash = null;
        this._promiseForSize = null;
    }

    getContent() {
        if (this._promiseForContent === null) {
            this._promiseForContent = Promise.resolve(mzfs.readFile(this.absolutePath))
                .then((content) => {
                    this.content = content;
                    return content;
                });
        }
        return this._promiseForContent;
    }

    getContentString() {
        if (this._promiseForContentString === null) {
            this._promiseForContentString = this.getContent()
                .then((content) => {
                    this.contentString = this.bufferToString(content);
                    return this.contentString;
                });
        }
        return this._promiseForContentString;
    }

    getHash() {
        if (this._promiseForHash === null) {
            this._promiseForHash = this.getContentString()
                .then((str) => {
                    this.hash = this.hashString(str);
                    return this.hash;
                });
        }
        return this._promiseForHash;
    }

    getSize() {
        if (this._promiseForSize === null) {
            this._promiseForSize = Promise.resolve(mzfs.stat(this.absolutePath))
                .then((stats) => {
                    this.size = stats.size;
                    return this.size;
                });
        }
        return this._promiseForSize;
    }

    hashString(str) {
        const hash = crypto.createHash('sha256');
        hash.update(str);
        return hash.digest('hex');
    }

    bufferToString(buffer) {
        return buffer.toString('utf-8');
    }
}
