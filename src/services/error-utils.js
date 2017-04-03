import stringTemplate from 'string-template';
import es6TemplateString from 'es6-template-strings';

function formatMessage(fmt, context) {
    if (typeof fmt === 'function') {
        return fmt(context);
    }
    else {
        return es6TemplateString(stringTemplate(String(fmt), context), context);
    }
}

/**
 * Creates a wrapper Error around the given `error` object, with the specified `fmt`
 * applied to generate the new error message, and the given original `error` attached
 * to the generated Error as the `cause` property.
 *
 * :param error:    The error to wrap. This should normally be an Error object, though this is
 *                  not strictly enforced.
 *
 * :param fmt:      Describes how to generate the new error message, from the current error message.
 *                  This can be either a String, in which case it is taken as a format description,
 *                  or it can be a function which will be invoked to get the message.
 *
 *                  In the former case, the string can either be a
 *                  `string-template`<https://www.npmjs.com/package/string-template> template string,
 *                  or a string containing an `es6-template-strings`<https://www.npmjs.com/package/es6-template-strings>
 *                  template. In both cases, the templates are given the following context:
 *
 *                  `0`:        The given `error` object.
 *                  `1`:        The original error message (see below).
 *                  `error`:    Same as `0`, the `error` object.
 *                  `message`:  Same as `1`, the original error message.
 *
 *                  Additionally, any "own" properties of the given `error` object are copied
 *                  into the context, as long as they don't clash with any of the above.
 *
 *                  Both template processing functions are applied, `string-template` first, and then
 *                  `es6-template-strings`. So it's possible, though unlikely, that the results of the first
 *                  could produce unexpected template placeholders that will be picked up by the latter.
 *                  If this is really an issue, you can pass in a function for the `fmt` parameter instead,
 *                  and apply only the transformation you care about.
 *
 *                  If `fmt` is a function, it will be invoked with a single argument, the same context
 *                  object that is used for the template functions.
 *
 * ## Original Error Message
 *
 * A good faith effort is maid to extract an original error message from the given `error`.
 * First, we try to extract `error.message`; if `error` is an `Error` object, this would
 * typically be the value with which the `Error` constructor is called. If this value is truthy,
 * it is used. If it is falsey, but the `error` value has a `toString` function, then the result
 * of calling this method without any arguments is used. If all else fails, the `error` value itself
 * is used. In all cases, the chosen result is case to a `String`.
 */
export function wrapError(error, fmt) {
    const originalErrorMessage = String(
        error.message || (error.toString && (typeof error.toString === 'function') && error.toString()) || error);
    const context = Object.assign({}, error, {0: error, 1: originalErrorMessage, error, message: originalErrorMessage});
    const generatedErrorMessage = (fmt && formatMessage(fmt, context)) || originalErrorMessage;
    const wrapperError = new Error(generatedErrorMessage);
    wrapperError.cause = error;
    return wrapperError;
}
