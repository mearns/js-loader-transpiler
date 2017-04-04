/**
 * We are deliberately breaking with the conventions of the webpack config in some cases,
 * because the conceptual model is signifcantly differnt. For instance, we don't necessarily
 * generate modules. The `module.rules` section is therefore moved to `output.handlers`.
 */

/**
 * Unless otherwise stated, all paths in config properties are resolved relative to the --root-dir,
 * which defaults to the CWD.
 */
configuration = {
    // An array of paths to directories that will be recursively scanned for source files.
    // Relative paths are resolved relative to the --root-dir.
    // While multiple directories are supported, it's typically recommended to only use one,
    // as multiple source directories all transpiling to the same destination directory could
    // lead to conflicts. A String is acceptable for a single entry.
    sourceDirs: ['./demo/src'],

    // A path, resolved relative to the --root-dir. Loaders are resolved based on this.
    // The default is the --root-dir.
    // TODO: XXX-2: configure resolve() options, including context as basedir.
    // TODO: XXX-3: Find packageData for resolve() options.
    context: './demo',

    // Configures where and how output is generated.
    output: {

        // Path to the directory where output will be generated (by default).
        // Specifically, relative paths generated for destination paths will be generated
        // are resolved relative to this. Relative paths in _this_ property are resolved
        // relative to the --root-dir.
        path: './demo/output',

        // Rules that define how each input files are transformed into output files.
        handlers: [
            {
                // ## HandlerContext
                //
                // Through out, we refer to an `HandlerContext`, which provides information to various
                // aspects of the handler. It contains at least the following properties:
                //
                //  * `data`: Initially an empty object, it can be used to pass information about the handler.
                //  * `resource`: The absolute path to the source file being transformed, including any query.
                //  * `resourcePath`: Like `resource`, but excluding the query.
                //  * `resourceQuery`: Only the query part of the `resource`, including the leading '?',
                //      or an empty string if there is no query.
                //  * `emitWarning(string: message, [metadata: {}])`: Function to Emit a WARNING level log message.
                //  * `emitError(string: message, [metadata: {}])`: Function to Emit an ERROR level log message.
                //      This does _not_ cause an error to actually be raised at all.
                //  * `log`: A logger instance for logging message. This is preferred over `emitWarning` and `emitError`.
                //  * `destDir`: A string giving the absolute path to the destination directory, as specified in the
                //      `output.path` configuration property.
                //  * `source`: An object describing the source file being handled, with the following properties:
                //      * `absolutePath`:   The absolute path to the file. This is the same as `resourcePath` in the parent
                //          HandlerContext.
                //      *  `sourceDir`:  The directory from which the source file was scanned. This will be one of the entries
                //          from the `sourceDirs` config property.
                //      *  `relativePath`: The path to the source file, relative to the `sourceDir`.
                //      * `size`:   The number of _octets_ in the source file's content.
                //      * `content`:    The content of the source file, as a buffer, if available. If not available, call `getContent`
                //      * `hash`:   A hash of the contents of the source file, as a string, if available. If not available, call `getHash`.
                //      * `getContent(): Promise<Buffer>`:  Call to get the content of the file, as a promise for a buffer.
                //      * `getHash(): Promise<String>`: Call to get the hash of the file, as a promise for a string.
                //
                //
                // ## Conditions
                //
                // To determine if a handler is applied to an input file, the file
                // is tested against a `Condition` composed from `test`, `include`, and `exclude`.
                // Each of which are additionally `Condition` objects. The `test` and `include`
                // are actually synonymous, but the convention is to use a regexp or array of regexps
                // in `test`, and a String or array of Strings in `include`. In order for the condition
                // to pass, the `test` _and_ `include` must both pass, _and_ the `exclude` condition
                // must _not_ pass.
                //
                // These are somewhat simplified compared to webpack, in order to avoid
                // implementing logic in a configuration object that could just as well
                // be implemented in a function.
                //
                // A `Condition` can be:
                // * a String: if the _absolute_ path of the source file _begins_ with the given string,
                //      the condition passes.
                // * a RegExp: the _absolute_ path is tested against the given regular expression,
                //      and the condition passes if and only if the test passes.
                // * a function: Invoked with arguments described below. The condition passes if and
                //      only if the function returns a truthy value or a Promise that fulfills with
                //      a truthy value before a timeout expires. If the Promise rejects, an error is
                //      raised.
                // * An array of conditions. If the array is not empty, then all conditions in the array
                //      must pass for the condition to pass. if the array is empty, then the condition is
                //      a "don't care", which means it will neither pass not fail. If used for a `test`
                //      or `include` condition, then it acts as a pass. If used for an `exclude` conditoin,
                //      then it acts as a fail (meaning it will _not_ fail the parent condition).
                // * An object with `test`, `include`, and `exclude` properties as described above.
                //      Additionally, you can specify a `__strict__` property with a truthy value: the default
                //      value is true. If the value of the property is true, then any unrecognized _own_ properties
                //      on the object will cause an error to be raised. This is useful for avoiding issues
                //      that may arise from unsupported properties, e.g., those copied from a webpack config.
                //
                // ### Condition Functions
                //
                // If a function is provided as a condition, it will be invoked with two arguments:
                // the first is the _absolute_ path to the source file. The second is the `HandlerContext`.
                //
                test: /\.ya?ml$/i,
                include: [],
                exclude: [],

                // Determines the path of the destination file. The default output is simply the path of the source file
                // relative to it's source directory, resolved relative to the destination directory. To override this, you can define this function
                // to return a String or a Promise that fulfills with a String; the resulting String will be used as the path
                // to the destination file, which will likewise be resolved relative to the destination directory.
                // If the functions returns, or fulfills with, a falsey value, the handler will still be
                // applied, but _no output file will be generated_. If the function errs or rejects, the error will be raised.
                // The function will be invoked with two arguments: the _absolute path_ of the _default destination_ file,
                // and the `HandlerContext`. The default destination file is simply the source path, relative to the source dir, but
                // resolved to the dest dir.
                destination: (defaultDestPath) => `${defaultDestPath}.json`,

                //
                // ## UseEntries
                //
                // An array of UseEntries that define how the source will be transformed into the output.
                // It can also be a single UseEntry.
                //
                // A `UseEntry` can be any of the following:
                //
                //  * A string, which is simply a shortcut for specifying the same value as the `loader` property of
                //      a UseEntry object (descirbed below).
                //  * A function which returns a `UseEntry` or a Promise that fulfills with a `UseEntry`. The function is
                //      invoked with the HandlerContext as the only argument.
                //  * An object, as described below.
                //
                // Each UseEntry is applied in sequence from first to last to transform the source input to the output.
                //
                // ### UseEntry Objects
                //
                // An object with the following _own_ properties can be used as a `UseEntry`:
                //
                // * `loader`: _Required_. A `LoaderSpecification` as described below.
                // * `options`: _Optional_. An arbitrary value of options to pass to the loader. Typically an object or string.
                // * `ident`: _Optional_. A string or function providing a hopefully unique identifier for this entry.
                //      Without this, we will attempt to stringify the loader and options, which works in most cases.
                //      If a function, it should return a String or a Promise that fulfills with a string without a timeout.
                //      The function will be passed the _resolved_ loader (described below), and the `options` value.
                // * `__strict__`: _Optional_. If defined with a truthy value, or not defined, then an error will be
                //      raised if the UseEntry object has any unrecognized properties.
                //
                // ### LoaderSpecifications
                //
                // A `Loader` transforms an input to an output, which may subsequently be transformed
                // by additinal Loaders. A `LoaderSpecification` specifies what loader to use. It can also
                // in some cases be used to provide additional options to the loader.
                //
                // A `LoaderSpecification` can be one of the following:
                //  * A String, specifying the module to `require`.
                //  * A function, which will be used _as_ the loader.
                //  * An object with the following properties:
                //      * `name`: The name of the loader.
                //      * `func`: The function to be used _as_ the loader.
                //
                use: [
                    'yaml-loader'
                ],

                // ## Forking Handlers
                // The `fork` property of a handler definition can be an array of additional handler definition objects.
                // The parent handler is applied first, and the output is written to the destination file if appropriate,
                // then the resulting output is used as _input_ to each of the children handlers. If the parent handler
                // is not run for an input, then none of the children are applied either.
                // XXX: Apply fork.
                fork: [
                    {
                        destination: (relativePath) => `${relativePath}.js`,
                        use: ['json-loader'],

                        fork: [
                            {
                                destination: (relativePath) => `${relativePath}.length`,
                                use: [
                                    (content) => String(content.length)
                                ]
                            }
                        ]
                    }
                ]
            }
        ]
    },


};

module.exports = configuration;
