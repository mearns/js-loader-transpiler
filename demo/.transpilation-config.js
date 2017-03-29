
module.exports = {
    rootDir: './demo/',
    sourceDir: 'src/',
    destDir: 'output/',
    handlers: [
        {
            test: /\.ya?ml$/i,
            loaders: [
                'yaml-loader',
                'json-loader'
            ]
        },
        {
            test: /\.ya?ml$/i,
            output: (basePath) => `${basePath}.json`,
            loaders: ['yaml-loader']
        }
    ]
};
