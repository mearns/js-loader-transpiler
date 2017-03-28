/* eslint no-console:0 */

import {readFile, writeFile, stat} from 'mz/fs';
import Promise from 'bluebird';
import packageJson from '../../package.json';
import path from 'path';
import resolve from 'resolve';
import {cwd} from 'process';
import * as R from 'ramda';
import _ from 'lodash';
import walk from 'walk';
import _mkdirp from 'mkdirp';

require('require-ensure');

const mkdirp = Promise.promisify(_mkdirp);

const PROJECT_NAME = packageJson.name;
const LOADER_API_VERSION = 1;

export function main(config) {

    // TODO: Handler option to transform input path to output path
    // TODO: An array of configs.
    // TODO: Promise for a config.
    // TODO: Function that returns a config (or array of, or promise for).

    const {rootDir = '.', sourceDir: _sourceDir = '.', destDir: _destDir, handlers = []} = config;
    if (!_destDir) {
        throw new Error('The "destDir" config property is required');
    }
    const sourceDir = path.resolve(rootDir, _sourceDir);
    const destDir = path.resolve(rootDir, _destDir);

    function processOneModule(directory, fileName) {
        const filePath = path.resolve(directory, fileName);
        const selectedHandlers = handlers
            .filter(({test}) => {
                if (test instanceof RegExp) {
                    return test.test(filePath);
                }
                else if (typeof test === 'function') {
                    return test(filePath);
                }
                return false;
            });
        const loaderSpecs = _.flatMap(selectedHandlers, ({loaders}) => {
            // TODO: Parse queries from loaderName
            // TODO: Accept objects as loaders.
            // TODO: Accept functions as loaders.
            return loaders.map((loaderName) => {
                return {
                    name: loaderName
                };
            });
        });
        return transpile({
            rootDir,
            context: directory,
            resourceSpec: {
                name: fileName
            },
            loaderSpecs
        })
            .then((output) => {
                // XXX: TODO: Convert between strings and buffers after each loader.
                const sourcePath = path.resolve(directory, fileName);
                const relativePath = path.relative(sourceDir, sourcePath);
                const outputPath = path.resolve(destDir, relativePath);
                const outputDir = path.dirname(outputPath);
                return mkdirp(outputDir)
                    .then(() => writeFile(outputPath, output))
                    .catch((error) => {
                        throw new Error(`Error trying to write output to "${outputPath}": ${error}`);
                    })
                    .then(() => ({
                        source: sourcePath,
                        dest: outputPath
                    }));
            });
    }

    return new Promise((fulfill, reject) => {
        const walker = walk.walk(sourceDir);
        const processing = [];
        const processed = [];
        const errors = [];

        walker.on('file', (root, stats, next) => {
            processing.push(
                processOneModule(root, stats.name)
                    .then((result) => processed.push(result))
                    .catch((error) => {
                        errors.push(
                            new Error(
                                `Error occurred processing module "${path.resolve(root, stats.name)}": ${error}`));
                    })
            );
            next();
        });

        walker.on('errors', (root, statsArray, next) => {
            errors.push(new Error(`Error occurred walking file system: ${statsArray.error}`));
            next();
        });

        walker.on('end', () => {
            Promise.all(processing)
                .then(() => {
                    if (errors.length) {
                        const error = new Error('Errors occurred processing modules');
                        error.errors = errors;
                        reject(error);
                    }
                    else {
                        fulfill(processed);
                    }
                });
        });
    })
        .catch((error) => {
            if (error.errors) {
                error.errors.forEach((e) => console.error(e));
            }
            throw error;
        })
        .then((processed) => {
            processed.forEach((module) => console.log(module));
        });
}

function unimplemented(feature) {
    return () => {
        throw new Error(`${feature} is not currently implemented by ${PROJECT_NAME}`);
    };
}

/**
 * Used to implement the `resolve` helper function passed in as part of `this`
 * context for loader functions. Given options, a context directory, and a request
 * for a module (with optional query and loaders), it will parse the request
 * and return a promise for the contents of the module as loaded according to
 * the request.
 *
 * This function basically just parses the request, and then delegates to `transpile`.
 */
function resolveRequest({rootDir, options, context, request}) {
    const POP_LAST_ELEMENT = -1;
    const requestSpecs = request.split('!').map((resourceRequest) => {
        const [name, query] = resourceRequest.split(/\?(.*)/);
        return {name, query: query ? `?${query}` : ''};
    });
    const resourceSpec = requestSpecs.pop(POP_LAST_ELEMENT);
    const loaderSpecs = requestSpecs.reverse();
    return transpile({rootDir, context, resourceSpec, loaderSpecs, options});
}

/**
 * Convenience wrapper around `resolveRequest` that takes a callback, instead of
 * returning a Promise.
 */
function resolveRequestAsync(rootDir, options, context, request, callback) {
    resolveRequest({rootDir, options, context, request})
        .catch((error) => {
            callback(error);
        })
        .then((output) => {
            callback(null, output);
        });
}

const resolveAsPromised = Promise.promisify(resolve);

function fileExists(filePath) {
    return Promise.resolve(stat(filePath))
        .then(() => true)
        .catch((error) => error.code !== 'ENOENT');
}

/**
 * Load a specified module request, resolving to the loaded contents.
 *
 * :param String rootDir: The root directory of the project. E.g., this is where we would
 *      expect to find node_modules/ and package.json if applicable. This will be the cwd
 *      if not specified.
 *
 * :param String context: The path to the working directory from which relative paths
 *      should be resolved. This will be resolved relative to `rootDir`, and is equal
 *      to the root dir if not specified.
 *
 * :param Object resourceSpec: An object describing the request for the resource, in
 *      the form `{name, query}`, where query is the optional query suffix for the request,
 *      _including_ the leading '?' if appropriate.
 *
 * :param Array loaderSpecs: An array of objects, specifying the sequence of loaders
 *      to be used to load the module. These are specified _in application order_,
 *      so a loader at a lower index will be applied _first_. This is counter to the order
 *      in which they are given in the request string, because there's a different conceptual
 *      model there. Each object in the array should describe one loader to be applied,
 *      in the form `{name, query}`.
 *
 * :param Object options:   An object of options that can be used to provide configuration
 *      options to loaders.
 */
function transpile({rootDir: _rootDir, context: _context, resourceSpec, loaderSpecs = [], options = {}}) {

    const rootDir = _rootDir || cwd();
    const context = path.resolve(rootDir, _context || '.');
    const {name: resourceName, query: resourceQuery} = resourceSpec;
    const sourcePath = path.resolve(context, resourceName);
    const sourceRequest = `${sourcePath}${resourceQuery}`;

    function readSourceFile() {
        return Promise.resolve(readFile(sourcePath))
            .catch((error) => {
                throw new Error(`Failed to read file "${sourcePath}": ${error}`);
            });
    }

    function readPackageJson() {
        const packageJsonPath = path.resolve(context, 'package.json');
        return fileExists(packageJsonPath)
            .then((exists) => {
                if (exists) {
                    return Promise.resolve(readFile(packageJsonPath))
                        .catch(() => {
                            throw new Error('Failed to read package.json');
                        })
                        .then(JSON.parse.bind(JSON));
                }
                else {
                    return {};
                }
            });
    }

    function resolveOneLoader(resolveOpts, spec) {
        return resolveAsPromised(spec.name, resolveOpts)
            .then((resolvedModulePath) => {
                return new Promise((fulfill) => {
                    require.ensure([resolvedModulePath], (req) => {
                        const query = (spec.query || '').trim();
                        fulfill(Object.assign({}, spec, {
                            query,
                            path: resolvedModulePath,
                            module: req(resolvedModulePath),
                            data: {},
                            request: `${resolvedModulePath}${query}`
                        }));
                    });
                });
            });
    }

    function resolveLoaders(packageData) {
        const resolveOpts = {
            package: packageData,
            basedir: rootDir
        };
        return Promise.map(loaderSpecs, R.partial(resolveOneLoader, [resolveOpts]));
    }

    return Promise.join(
        readSourceFile(),
        readPackageJson().then(resolveLoaders),
        (sourceContent, resolvedLoaderSpecs) => {

            const requestString = resolvedLoaderSpecs.map(R.prop('request')).reverse()
                .concat([sourceRequest]).join('!');

            const baseContext = {
                version: LOADER_API_VERSION,
                context,
                request: requestString,
                loaders: resolvedLoaderSpecs.map((spec) => _.pick(spec, ['request', 'path', 'query', 'module'])),
                resource: sourceRequest,
                resourcePath: sourcePath,
                resourceQuery: resourceQuery,
                resolveSync: unimplemented('The "resolveSync" function'),
                resolve: R.partial(resolveRequestAsync, [rootDir, options]),
                addDependency: () => {},    // no watching or caching yet
                addContextDependency: () => {}, // no watching or caching yet
                clearDependencies: () => {},    // no watching or caching yet
                options,
                debug: false,
                minimize: false,
                sourceMap: false,
                target: 'node',
                webpack: false,
                emitFile: unimplemented('The "emitFile" function')
            };

            return resolvedLoaderSpecs.reduce((chain, {module, query, data}, loaderIndex) => {
                return chain.then(({content, inputValue}) => {
                    const loaderContext = Object.assign({}, baseContext, {
                        query,
                        data,
                        cacheable: () => {},
                        emitWarning: () => {},  // TODO: Collect and emit Warnings
                        emitError: () => {},  // TODO: Collect and emit Errors
                        exec: unimplemented('The "exec" loader utility'),
                        // TODO: resolve and resolveSync basically looks like it's just doing this entire function,
                        // plus parsing, to turn a "require" expression into a string.
                        loaderIndex,
                        inputValue,
                        async: () => callback
                    });

                    let fulfill, reject;
                    const promise = new Promise((_fulfill, _reject) => {
                        fulfill = _fulfill;
                        reject = _reject;
                    });
                    function callback(error, result) {
                        if (error) {
                            reject(error);
                        }
                        else {
                            fulfill({content: result, value: loaderContext.value});
                        }
                    }

                    const newContent = module.bind(loaderContext)(content);
                    if (!_.isUndefined(newContent)) {
                        callback(null, newContent);
                    }
                    return promise;
                });
            }, Promise.resolve({
                content: sourceContent
            }));
        }
    )
        .then(R.prop('content'));
}
