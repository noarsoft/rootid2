const {
    isPlainObject,
    assertPlainObject,
    hasOwn,
    getArrayField,
    getControls,
    getColumns,
    setControls,
    setColumns,
    defaultControlByTypeForForm,
    defaultControlByTypeForView,
} = require('../payload-helpers');

describe('payload-helpers', () => {
    describe('isPlainObject', () => {
        it('returns true for plain objects', () => {
            expect(isPlainObject({})).toBe(true);
            expect(isPlainObject({ a: 1 })).toBe(true);
        });

        it('returns false for arrays', () => {
            expect(isPlainObject([])).toBe(false);
            expect(isPlainObject([1, 2])).toBe(false);
        });

        it('returns false for null/undefined', () => {
            expect(isPlainObject(null)).toBe(false);
            expect(isPlainObject(undefined)).toBe(false);
        });

        it('returns false for primitives', () => {
            expect(isPlainObject(42)).toBe(false);
            expect(isPlainObject('str')).toBe(false);
            expect(isPlainObject(true)).toBe(false);
        });
    });

    describe('assertPlainObject', () => {
        it('does not throw for plain objects', () => {
            expect(() => assertPlainObject({})).not.toThrow();
            expect(() => assertPlainObject({ x: 1 })).not.toThrow();
        });

        it('throws for non-objects with INVALID_OBJECT code', () => {
            expect(() => assertPlainObject(null, 'payload')).toThrow('payload must be a plain object');
            try {
                assertPlainObject([], 'data');
            } catch (e) {
                expect(e.code).toBe('INVALID_OBJECT');
            }
        });
    });

    describe('hasOwn', () => {
        it('returns true for own properties', () => {
            expect(hasOwn({ a: 1 }, 'a')).toBe(true);
        });

        it('returns false for missing properties', () => {
            expect(hasOwn({ a: 1 }, 'b')).toBe(false);
        });

        it('returns false for prototype properties', () => {
            expect(hasOwn({}, 'toString')).toBe(false);
        });
    });

    describe('getArrayField', () => {
        it('returns array for matching key', () => {
            expect(getArrayField({ controls: [1, 2] }, 'controls')).toEqual([1, 2]);
        });

        it('tries keys in order and returns first array found', () => {
            expect(getArrayField({ fields: [3] }, 'controls', 'fields')).toEqual([3]);
        });

        it('returns empty array if no key matches', () => {
            expect(getArrayField({ x: 'str' }, 'controls', 'fields')).toEqual([]);
        });

        it('returns empty array for non-object payload', () => {
            expect(getArrayField(null, 'controls')).toEqual([]);
            expect(getArrayField(42, 'controls')).toEqual([]);
        });
    });

    describe('getControls', () => {
        it('finds controls key', () => {
            expect(getControls({ controls: ['a'] })).toEqual(['a']);
        });

        it('falls back to fields key', () => {
            expect(getControls({ fields: ['b'] })).toEqual(['b']);
        });

        it('falls back to items key', () => {
            expect(getControls({ items: ['c'] })).toEqual(['c']);
        });

        it('returns empty for no match', () => {
            expect(getControls({ other: [1] })).toEqual([]);
        });
    });

    describe('getColumns', () => {
        it('finds columns key', () => {
            expect(getColumns({ columns: ['col1'] })).toEqual(['col1']);
        });

        it('falls back to fields then items', () => {
            expect(getColumns({ items: ['i1'] })).toEqual(['i1']);
        });
    });

    describe('setControls', () => {
        it('sets controls on existing payload', () => {
            const result = setControls({ colnumbers: 6 }, ['a', 'b']);
            expect(result).toEqual({ colnumbers: 6, controls: ['a', 'b'] });
        });

        it('wraps controls in object if payload is not an object', () => {
            expect(setControls(null, ['x'])).toEqual({ controls: ['x'] });
        });

        it('does not mutate original payload', () => {
            const original = { colnumbers: 4, controls: ['old'] };
            const result = setControls(original, ['new']);
            expect(original.controls).toEqual(['old']);
            expect(result.controls).toEqual(['new']);
        });
    });

    describe('setColumns', () => {
        it('sets columns on existing payload', () => {
            const result = setColumns({ title: 'test' }, ['c1']);
            expect(result).toEqual({ title: 'test', columns: ['c1'] });
        });

        it('wraps columns in object if payload is not an object', () => {
            expect(setColumns(undefined, ['y'])).toEqual({ columns: ['y'] });
        });
    });

    describe('defaultControlByTypeForForm', () => {
        it('maps string to textbox', () => {
            expect(defaultControlByTypeForForm('string')).toBe('textbox');
        });

        it('maps number to numberbox', () => {
            expect(defaultControlByTypeForForm('number')).toBe('numberbox');
        });

        it('maps integer to numberbox', () => {
            expect(defaultControlByTypeForForm('integer')).toBe('numberbox');
        });

        it('maps boolean to checkbox', () => {
            expect(defaultControlByTypeForForm('boolean')).toBe('checkbox');
        });

        it('maps date/datetime to datepicker', () => {
            expect(defaultControlByTypeForForm('date')).toBe('datepicker');
            expect(defaultControlByTypeForForm('datetime')).toBe('datepicker');
        });

        it('maps select/dropdown/toggle/slider/rating', () => {
            expect(defaultControlByTypeForForm('select')).toBe('select');
            expect(defaultControlByTypeForForm('dropdown')).toBe('dropdown');
            expect(defaultControlByTypeForForm('toggle')).toBe('toggle');
            expect(defaultControlByTypeForForm('slider')).toBe('slider');
            expect(defaultControlByTypeForForm('rating')).toBe('rating');
        });

        it('defaults to textbox for unknown types', () => {
            expect(defaultControlByTypeForForm('anything')).toBe('textbox');
        });
    });

    describe('defaultControlByTypeForView', () => {
        it('maps string to label', () => {
            expect(defaultControlByTypeForView('string')).toBe('label');
        });

        it('maps number/integer to number', () => {
            expect(defaultControlByTypeForView('number')).toBe('number');
            expect(defaultControlByTypeForView('integer')).toBe('number');
        });

        it('maps boolean to checkbox', () => {
            expect(defaultControlByTypeForView('boolean')).toBe('checkbox');
        });

        it('maps date/datetime to label', () => {
            expect(defaultControlByTypeForView('date')).toBe('label');
            expect(defaultControlByTypeForView('datetime')).toBe('label');
        });

        it('defaults to label for unknown types', () => {
            expect(defaultControlByTypeForView('xyz')).toBe('label');
        });
    });
});
