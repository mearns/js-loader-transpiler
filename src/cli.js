import yargs from 'yargs';
import {main} from './main';
import process from 'process';
import path from 'path';
import {Logger} from './services/logger';
import projectData from '../../package.json';
import Promise from 'bluebird';

export function cli() {
    const args = yargs
        .option('config', {
            alias: 'c',
            description: 'path to the config file',
            default: './.transpilation-config.js',
            string: true
        })
        .argv;

    // TODO: Use js-interpret to load from various languages.
    const configData = require(path.resolve(process.cwd(), args.config));

    const options = {
        log: new Logger(projectData.name)
    };
    main(options, [Promise.resolve(configData)]);
}
