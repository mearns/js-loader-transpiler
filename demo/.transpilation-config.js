
module.exports = {
    rootDir: './demo/',
    sourceDir: 'src/',
    destDir: 'output/',
    handlers: [
        {
            test: /\.ya?ml$/i,
            output: (basePath) => basePath,
            loaders: [
                'yaml-loader',
                'json-loader'
            ]
        }
    ]
};
