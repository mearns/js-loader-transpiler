
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
        }
    ]
};
