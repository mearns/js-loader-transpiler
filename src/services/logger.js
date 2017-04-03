import leftpad from 'leftpad';

const CRITICAL = 0;
const ERROR = 1;
const WARNING = 2;
const INFO = 3;
const DEBUG = 4;
const TRACE = 5;

class MultilineLogBuilder {
    constructor() {
        this._lines = [];
        this._metadata = {};
    }

    appendLine(line) {
        this._lines.append(line);
        return this;
    }

    addMetaData(metadata) {
        Object.assign(this._metadata, metadata);
        return this;
    }

    logWith(loggerFunction) {
        loggerFunction(this._lines, this._metadata);
    }
}

export class Logger {

    constructor(name) {
        this._name = name;

        [
            [CRITICAL, 'critical'],
            [ERROR, 'error'],
            [WARNING, 'warning'],
            [INFO, 'info'],
            [DEBUG, 'debug'],
            [TRACE, 'trace']
        ].forEach(([level, methodName]) => {
            this[methodName] = (function (...args) {
                return this.log(level, ...args);
            }).bind(this);
        });
    }

    getName() {
        return this._name;
    }

    multilineLogBuilder() {
        return new MultilineLogBuilder();
    }

    describeLevel(level) {
        switch (level) {
            case CRITICAL: return 'CRITICAL';
            case ERROR: return 'ERROR   ';
            case WARNING: return 'WARNING ';
            case INFO: return 'INFO    ';
            case DEBUG: return 'DEBUG   ';
            case TRACE: return 'TRACE   ';
            default: return leftpad(level, 'CRITICAL'.length());
        }
    }

    log(level, _lines, metadata) {
        const now = new Date();
        const lines = _lines instanceof Array ? _lines : [_lines];
        const stream = this.isError(level) ? console.error : console.log; // eslint-disable-line no-console

        const lineNumberFromIndex = (index) => index + 1;   // eslint-disable-line no-magic-numbers
        lines.forEach((line, index) => {
            stream(this.formatLogLine(now, level, line, metadata, lineNumberFromIndex(index), lines.length));
        });
    }

    isError(level) {
        return level <= ERROR;
    }

    formatTimestamp(date) {
        return date.toISOString();
    }

    formatMetaData(metadata) {
        return JSON.stringify(metadata);
    }

    getFieldSeparator() {
        return ':';
    }

    formatLogLine(now, level, line, metadata, lineNumber, totalLines) {
        const components = [
            this.getName(), this.formatTimestamp(now), this.describeLevel(level),
            `${lineNumber}/${totalLines}`, lineNumber === totalLines && this.formatMetaData(metadata),
            line
        ].filter(Boolean);
        return components.join(this.getFieldSeparator());
    }
}
