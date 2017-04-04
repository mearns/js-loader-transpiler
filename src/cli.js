import yargs from 'yargs';
import {main} from './main';
import process from 'process';
import path from 'path';
import {Logger} from './services/logger';
import projectData from '../../package.json';
import Promise from 'bluebird';
import _ from 'lodash';

export function cli() {

    const CWD = process.cwd();
    const resolvePath = (input) => path.resolve(CWD, input);

    const args = yargs
        .option('config', {
            alias: 'c',
            description: 'path to the config file, relative to the current directory.',
            default: './.transpilation-config.js',
            requiresArg: true,
            string: true,
            coerce: resolvePath
        })
        .option('root-dir', {
            description: 'The path to the project\'s root directory.',
            default: process.cwd(),
            requiresArg: true,
            string: true,
            coerce: resolvePath
        })
        .option('debug', {
            description: 'Turn on debugging.',
            default: false,
            boolean: true
        })
        .strict()
        .argv;

    // TODO: Use js-interpret to load from various languages.
    const configData = require(args.config);

    const options = Object.assign({
        log: new Logger(projectData.name),
    }, _.pick(args, ['rootDir', 'debug']));

    main(options, [Promise.resolve(configData)]);
}
