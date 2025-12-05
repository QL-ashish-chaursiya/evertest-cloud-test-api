/**
 * Delays execution for a specified number of milliseconds.
 * @param {number} ms - The number of milliseconds to wait.
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normalizes a URL by removing trailing slashes and ensuring consistency.
 * @param {string} url - The URL to normalize.
 * @returns {string} - The normalized URL.
 */
const normalizeUrl = (url) => {
    try {
        const urlObj = new URL(url);
        // Remove trailing slash from pathname if present
        if (urlObj.pathname.endsWith('/') && urlObj.pathname.length > 1) {
            urlObj.pathname = urlObj.pathname.slice(0, -1);
        }
        return urlObj.href;
    } catch (e) {
        return url;
    }
};

module.exports = {
    delay,
    normalizeUrl,
};
