// utils/responseFormatter.js

/**
 * Sends a standardized JSON response.
 *
 * @param {object} res - Express response object.
 * @param {boolean} success - Indicates if the request was successful.
 * @param {any} data - The data payload to return (optional).
 * @param {string} message - A message string (optional).
 */
exports.jsonResponse = (res, success, data = null, message = '') => {
	res.json({
		success,
		data,
		message,
	});
};
