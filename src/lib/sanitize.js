// Recursive sanitizer for request bodies and template data
export default function sanitizeData(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(sanitizeData);
    if (typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) {
            out[k] = sanitizeData(value[k]);
        }
        return out;
    }
    if (typeof value === 'string') {
        const normalized = value.replace(/\r\n/g, '\n');
        const trimmed = normalized.trim();
        if (trimmed === 'undefined' || trimmed === 'null') return '';
        return trimmed
            .split('\n')
            .map(line => line.replace(/\s+/g, ' ').trim())
            .join('\n');
    }
    return value;
}
