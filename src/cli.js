import yargs from 'yargs';
import {main} from './main';
import process from 'process';
import path from 'path';

export function cli() {
    const args = yargs
        .option('config', {
            alias: 'c',
            description: 'path to the config file',
            default: './.transpilation-config.js',
            string: true
        })
        .option('rootDir', {
            description: 'The root directory to operate from. Does NOT apply to command line arguments',
            default: process.cwd(),
            string: true
        })
        .argv;

    const configData = require(path.resolve(process.cwd(), args.config));
    main(configData);
}
