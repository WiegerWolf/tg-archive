/**
 * Returns a new object without the specified paths.
 * @param obj object to be filtered
 * @param paths paths to omit from the object
 * @returns a new object without the specified paths
 */
export function omitPaths(obj: any, paths: string[]): any {
    const _deepCopy = deepCopy(obj);

    // Helper function to omit a path from an object
    function omitPath(obj: any, path: string) {
        if (!path) {
            return;
        }

        const keys = path.split('.');
        let current = obj;

        for (let i = 0; i < keys.length - 1; i++) {
            if (current[keys[i]] === undefined) {
                return;
            }
            current = current[keys[i]];
        }
        if (current) delete current[keys[keys.length - 1]];
    }

    // Iterate through all paths and omit them from the object
    paths.forEach(path => omitPath(_deepCopy, path));
    
    return _deepCopy;
}

/**
 * Creates a deep copy of an object, including all nested objects.
 * Does not use JSON.stringify/parse, so it can handle functions and circular references.
 * Also it keeps track of circular references and will not enter an infinite loop.
 * 
 * @param obj object to be copied
 * @returns a deep copy of the object
 */
export function deepCopy(obj: any): any {
    const seen = new Map();

    function _deepCopy(obj: any): any {
        if (typeof obj !== 'object' || obj === null) {
            return obj;
        }

        if (seen.has(obj)) {
            return seen.get(obj);
        }

        if (Array.isArray(obj)) {
            const copy: any[] = [];
            seen.set(obj, copy);
            obj.forEach((item, index) => {
                copy[index] = _deepCopy(item);
            });
            return copy;
        }

        const copy: any = {};
        seen.set(obj, copy);
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key)) {
                copy[key] = _deepCopy(obj[key]);
            }
        }
        return copy;
    }

    return _deepCopy(obj);
}