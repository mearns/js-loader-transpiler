
export class OutputGenerator {

    constructor(options, source, dest) {
        this._options = options;
        this._source = source;
        this._dest = dest;
    }

    /**
     * Return a string specifiying the path to the destination file, relative to the cwd.
     */
    getDestination() {
        return this._dest;
    }

    /**
     * Return a string describing the origin of this output. This should typically include
     * a terse description of the handler and the input file.
     *
     * TODO: implement getOrigin, here or in subclasses.
     */
    getOrigin() {}

    /**
     * Actually generate output files, given the provided object of `options`.
     */
    generateOutput() {
        throw new Error('generateOutput method not implemented. You should extend this type');
    }
}
