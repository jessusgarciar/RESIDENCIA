const SPANISH_MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

function normalizeDateInput(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const fromNumber = new Date(value);
        return Number.isNaN(fromNumber.getTime()) ? null : fromNumber;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const isoMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
        if (isoMatch) {
            const year = parseInt(isoMatch[1], 10);
            const month = parseInt(isoMatch[2], 10) - 1;
            const day = parseInt(isoMatch[3], 10);
            const constructed = new Date(year, month, day);
            return Number.isNaN(constructed.getTime()) ? null : constructed;
        }
        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) return parsed;
    }
    return null;
}

export function formatDateLongSpanish(value) {
    if (value === null || value === undefined) return '';
    const date = normalizeDateInput(value);
    if (!date) return typeof value === 'string' ? value : '';
    const day = String(date.getDate()).padStart(2, '0');
    const monthName = SPANISH_MONTHS[date.getMonth()] || '';
    const year = date.getFullYear();
    return `${day} de ${monthName} de ${year}`;
}

export function formatDatesDeep(input) {
    if (Array.isArray(input)) {
        return input.map((item) => formatDatesDeep(item));
    }
    if (input instanceof Date) {
        return formatDateLongSpanish(input);
    }
    if (input && typeof input === 'object') {
        const entries = {};
        for (const [key, value] of Object.entries(input)) {
            if (value && typeof value === 'object') {
                entries[key] = formatDatesDeep(value);
            } else if (typeof key === 'string' && /fecha/i.test(key)) {
                entries[key] = formatDateLongSpanish(value);
            } else {
                entries[key] = value;
            }
        }
        return entries;
    }
    return input;
}

export default {
    formatDateLongSpanish,
    formatDatesDeep
};
