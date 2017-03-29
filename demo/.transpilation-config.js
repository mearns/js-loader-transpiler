const crypto = require('crypto');
const querystring = require('querystring');

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
        },
        {
            test: true,
            output: (basePath) => `${basePath}.hash`,
            loaders: [
                {
                    name: 'hash',
                    query: '?algorithm=sha256',
                    loader: function (content) {
                        const query = this.query || '';
                        const args = {};
                        if (query.startsWith('?')) {
                            Object.assign(args, querystring.parse(query.substr(1)));
                        }
                        const algorithm = args.algorithm || 'sha256';
                        const hash = crypto.createHash(algorithm);
                        hash.update(content);
                        return hash.digest('hex');
                    }
                }
            ]
        }
    ]
};
