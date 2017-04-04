import Promise from 'bluebird';
import _ from 'lodash';
import R from 'ramda';
import {Configuration} from './services/configuration-service';
import {wrapError, getDeepStackTrace} from './services/error-utils';
import process from 'process';

const lengthGreaterThanOne = (list) => list.length > 1; // eslint-disable-line no-magic-numbers
const getOutputGeneratorDestination = (gen) => gen.getDestination();
const getOutputGeneratorOrigin = (gen) => gen.getOrigin();

function assertNoMultiplyTargetedDestinations(options, outputGenerators) {
    const generatorsByDest = R.groupBy(getOutputGeneratorDestination, outputGenerators);
    const destinationsTargetedMultipleTimes = R.filter(lengthGreaterThanOne)(generatorsByDest);
    if (destinationsTargetedMultipleTimes.length) {
        options.log.error(
            'At least one destination file is targeted by multiple transformations, no output generated.',
            {
                multiplyTargetedDestinations: Object.keys(destinationsTargetedMultipleTimes)
            }
        );
        if (options.debug) {
            const logBuilder = options.log.multilineLogBuilder();
            logBuilder.appendLine(
                'The following destination files are targeted by multiple transformations:');
            _.forOwn(destinationsTargetedMultipleTimes, (dest, generators) => {
                logBuilder.appendLine(`  * ${dest}`);
                generators.forEach((gen) => {
                    logBuilder.appendLine(`      <-- ${getOutputGeneratorOrigin(gen)}`);
                });
            });
            logBuilder.addMetaData({
                conflictingTargets: R.mapObjIndexed((generators) => {
                    return generators.map(getOutputGeneratorOrigin);
                })(destinationsTargetedMultipleTimes)
            });
            logBuilder.logWith(options.log.error);
        }
        throw new Error('Destination files are targeted by more than one handler');
    }
}

export function main(options, promisesForConfigs) {
    return Promise.all(promisesForConfigs.map((promiseForConfig) => {
        return promiseForConfig
            .then((config) => new Configuration(options, config))
            .then((configuration) => configuration.getOutputGeneratorsForConfig());
    }))
        .then((outputGeneratorLists) => {
            const outputGenerators = _.flatten(outputGeneratorLists);
            assertNoMultiplyTargetedDestinations(options, outputGenerators);
            return Promise.map(outputGenerators, (gen) => gen.generateOutput());
        })
        .catch((originalError) => {
            const error = wrapError(originalError, 'Error transpiling content: {message}');
            process.exitCode = 1;

            if (options.debug) {
                console.error(getDeepStackTrace(error));    // eslint-disable-line no-console
                throw error;
            }
            else {
                console.error(error.message);       // eslint-disable-line no-console
            }
        });
}
