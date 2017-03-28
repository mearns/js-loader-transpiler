import {readFile} from 'mz/fs';
import Promise from 'bluebird';
import path, {dirname} from 'path';
import resolve from 'resolve';
import {cwd} from 'process';
import * as R from 'ramda';
import _ from 'lodash';

require('require-ensure');

const LOADER_API_VERSION = 1;

export function demo() {
    console.log('------------------------');
    return transpile('demo/config.yaml', [
        {
            name: 'yaml-loader',
            query: '?foo=bar'
        },
        {
            name: 'json-loader'
        }
    ])
        .tap(() => console.log('XXXXXXXXXXXXXXXXXXXXXX'))
        .then((output) => console.log(output));
}

export function transpile(sourcePath, loaderSpecs) {

    const resolveAsPromised = Promise.promisify(resolve);

    return Promise.join(
        Promise.resolve(readFile(sourcePath))
            .catch((error) => {
                throw new Error(`Failed to read file "${sourcePath}": ${error}`);
            }),
        Promise.resolve(readFile('./package.json'))
            .catch(() => {
                throw new Error('Failed to read package.json');
            })
            .then((packageData) => {
                const resolveOpts = {
                    package: packageData,
                    basedir: cwd()
                };

                return Promise.map(loaderSpecs, (spec) => {
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
                });
            }),
        (sourceContent, resolvedLoaderSpecs) => {

            const requestString = resolvedLoaderSpecs.map(R.prop('request')).reverse()
                .concat([path.resolve(sourcePath)]).join('!');

            const resource = path.resolve(sourcePath);
            const baseContext = {
                version: LOADER_API_VERSION,
                context: dirname(resource),
                request: requestString,
                loaders: resolvedLoaderSpecs.map((spec) => _.pick(spec, ['request', 'path', 'query', 'module'])),
                resource,
                resourcePath: resource,
                resourceQuery: '',
            };

            return resolvedLoaderSpecs.reduce((chain, {module, query, data}, loaderIndex) => {
                return chain.then((source) => {
                    const context = Object.assign({}, baseContext, {
                        query,
                        data,
                        cacheable: () => {},
                        emitWarning: () => {},  // TODO: Collect and emit Warnings
                        emitError: () => {},  // TODO: Collect and emit Errors
                        loaderIndex
                    });
                    console.log(context);
                    const result = module.bind(context)(source);
                    return result;
                });
            }, Promise.resolve(sourceContent));
        }
    );
}
