// CommonJS version
const express = require("express");
const multer = require("multer");

/**
 * Universal body parser (JSON, x-www-form-urlencoded, multipart/form-data)
 * @param {Object} [options]
 * @param {"memory"|"disk"} [options.multerStorage="memory"] - Where to store uploaded files
 * @param {string} [options.uploadDest="uploads/"]           - Destination folder when using disk storage
 * @param {Object} [options.limits]                          - Multer limits (e.g., { fileSize: 5 * 1024 * 1024 })
 */
function universalBodyParser(options = {}) {
	const { multerStorage = "memory", uploadDest = "uploads/", limits } = options;

	const upload = multer(
		multerStorage === "disk"
			? { dest: uploadDest, limits }
			: { storage: multer.memoryStorage(), limits },
	);

	return (req, res, next) => {
		const type = (req.headers["content-type"] || "").toLowerCase();

		if (type.includes("application/json")) {
			return express.json()(req, res, next);
		}
		if (type.includes("application/x-www-form-urlencoded")) {
			return express.urlencoded({ extended: true })(req, res, next);
		}
		if (type.includes("multipart/form-data")) {
			// Accept all fields/files; access via req.body / req.files
			return upload.any()(req, res, next);
		}
		return next();
	};
}

module.exports = universalBodyParser;
