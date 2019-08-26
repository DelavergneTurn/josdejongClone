var assert = require('assert');
var util = require('../src/js/util');

describe('util', function () {

  describe('repair', function () {

    it('should leave valid JSON as is', function () {
      assert.strictEqual(util.repair('{"a":2}'), '{"a":2}');
    });

    it('should replace JavaScript with JSON', function () {
      assert.strictEqual(util.repair('{a:2}'), '{"a":2}');
      assert.strictEqual(util.repair('{a: 2}'), '{"a": 2}');
      assert.strictEqual(util.repair('{\n  a: 2\n}'), '{\n  "a": 2\n}');
      assert.strictEqual(util.repair('{\'a\':2}'), '{"a":2}');
      assert.strictEqual(util.repair('{a:\'foo\'}'), '{"a":"foo"}');
      assert.strictEqual(util.repair('{a:\'foo\',b:\'bar\'}'), '{"a":"foo","b":"bar"}');

      // should leave string content untouched
      assert.strictEqual(util.repair('"{a:b}"'), '"{a:b}"');
    });

    it('should add/remove escape characters', function () {
      assert.strictEqual(util.repair('"foo\'bar"'), '"foo\'bar"');
      assert.strictEqual(util.repair('"foo\\"bar"'), '"foo\\"bar"');
      assert.strictEqual(util.repair('\'foo"bar\''), '"foo\\"bar"');
      assert.strictEqual(util.repair('\'foo\\\'bar\''), '"foo\'bar"');
      assert.strictEqual(util.repair('"foo\\\'bar"'), '"foo\'bar"');
    });

    it('should replace special white characters', function () {
      assert.strictEqual(util.repair('{"a":\u00a0"foo\u00a0bar"}'), '{"a": "foo\u00a0bar"}');
      assert.strictEqual(util.repair('{"a":\u2009"foo"}'), '{"a": "foo"}');
    });

    it('should escape unescaped control characters', function () {
      assert.strictEqual(util.repair('"hello\bworld"'), '"hello\\bworld"')
      assert.strictEqual(util.repair('"hello\fworld"'), '"hello\\fworld"')
      assert.strictEqual(util.repair('"hello\nworld"'), '"hello\\nworld"')
      assert.strictEqual(util.repair('"hello\rworld"'), '"hello\\rworld"')
      assert.strictEqual(util.repair('"hello\tworld"'), '"hello\\tworld"')
      assert.strictEqual(util.repair('{"value\n": "dc=hcm,dc=com"}'), '{"value\\n": "dc=hcm,dc=com"}')
    })

    it('should replace left/right quotes', function () {
      assert.strictEqual(util.repair('\u2018foo\u2019'), '"foo"')
      assert.strictEqual(util.repair('\u201Cfoo\u201D'), '"foo"')
      assert.strictEqual(util.repair('\u0060foo\u00B4'), '"foo"')
    });

    it('remove comments', function () {
      assert.strictEqual(util.repair('/* foo */ {}'), ' {}');
      assert.strictEqual(util.repair('/* foo */ {}'), ' {}');
      assert.strictEqual(util.repair('{a:\'foo\',/*hello*/b:\'bar\'}'), '{"a":"foo","b":"bar"}');
      assert.strictEqual(util.repair('{\na:\'foo\',//hello\nb:\'bar\'\n}'), '{\n"a":"foo",\n"b":"bar"\n}');

      // should not remove comments in string
      assert.strictEqual(util.repair('{"str":"/* foo */"}'), '{"str":"/* foo */"}');
    });

    it('should strip JSONP notation', function () {
      // matching
      assert.strictEqual(util.repair('callback_123({});'), '{}');
      assert.strictEqual(util.repair('callback_123([]);'), '[]');
      assert.strictEqual(util.repair('callback_123(2);'), '2');
      assert.strictEqual(util.repair('callback_123("foo");'), '"foo"');
      assert.strictEqual(util.repair('callback_123(null);'), 'null');
      assert.strictEqual(util.repair('callback_123(true);'), 'true');
      assert.strictEqual(util.repair('callback_123(false);'), 'false');
      assert.strictEqual(util.repair('/* foo bar */ callback_123 ({})'), '{}');
      assert.strictEqual(util.repair('/* foo bar */ callback_123 ({})'), '{}');
      assert.strictEqual(util.repair('/* foo bar */\ncallback_123({})'), '{}');
      assert.strictEqual(util.repair('/* foo bar */ callback_123 (  {}  )'), '  {}  ');
      assert.strictEqual(util.repair('  /* foo bar */   callback_123 ({});  '), '{}');
      assert.strictEqual(util.repair('\n/* foo\nbar */\ncallback_123 ({});\n\n'), '{}');

      // non-matching
      assert.strictEqual(util.repair('callback {}'), 'callback {}');
      assert.strictEqual(util.repair('callback({}'), 'callback({}');
    });

    it('should strip trailing zeros', function () {
      // matching
      assert.strictEqual(util.repair('[1,2,3,]'), '[1,2,3]');
      assert.strictEqual(util.repair('[1,2,3,\n]'), '[1,2,3\n]');
      assert.strictEqual(util.repair('[1,2,3,  \n  ]'), '[1,2,3  \n  ]');
      assert.strictEqual(util.repair('{"a":2,}'), '{"a":2}');

      // not matching
      assert.strictEqual(util.repair('"[1,2,3,]"'), '"[1,2,3,]"');
      assert.strictEqual(util.repair('"{a:2,}"'), '"{a:2,}"');
    });

    it('should strip MongoDB data types', function () {
      var mongoDocument = '{\n' +
          '   "_id" : ObjectId("123"),\n' +
          '   "isoDate" : ISODate("2012-12-19T06:01:17.171Z"),\n' +
          '   "regularNumber" : 67,\n' +
          '   "long" : NumberLong("2"),\n' +
          '   "long2" : NumberLong(2),\n' +
          '   "int" : NumberInt("3"),\n' +
          '   "int2" : NumberInt(3),\n' +
          '   "decimal" : NumberDecimal("4"),\n' +
          '   "decimal2" : NumberDecimal(4)\n' +
          '}';

      var expectedJson = '{\n' +
          '   "_id" : "123",\n' +
          '   "isoDate" : "2012-12-19T06:01:17.171Z",\n' +
          '   "regularNumber" : 67,\n' +
          '   "long" : "2",\n' +
          '   "long2" : 2,\n' +
          '   "int" : "3",\n' +
          '   "int2" : 3,\n' +
          '   "decimal" : "4",\n' +
          '   "decimal2" : 4\n' +
          '}';

      assert.strictEqual(util.repair(mongoDocument), expectedJson);
    });
  });

  describe('jsonPath', function () {

    it('should stringify an array of paths', function() {
      assert.deepStrictEqual(util.stringifyPath([]), '');
      assert.deepStrictEqual(util.stringifyPath(['foo']), '.foo');
      assert.deepStrictEqual(util.stringifyPath(['foo', 'bar']), '.foo.bar');
      assert.deepStrictEqual(util.stringifyPath(['foo', 2]), '.foo[2]');
      assert.deepStrictEqual(util.stringifyPath(['foo', 2, 'bar']), '.foo[2].bar');
      assert.deepStrictEqual(util.stringifyPath(['foo', 2, 'bar_baz']), '.foo[2].bar_baz');
      assert.deepStrictEqual(util.stringifyPath([2]), '[2]');
      assert.deepStrictEqual(util.stringifyPath(['foo', 'prop-with-hyphens']), '.foo["prop-with-hyphens"]');
      assert.deepStrictEqual(util.stringifyPath(['foo', 'prop with spaces']), '.foo["prop with spaces"]');
    })

    it ('should parse a json path', function () {
      assert.deepStrictEqual(util.parsePath(''), []);
      assert.deepStrictEqual(util.parsePath('.foo'), ['foo']);
      assert.deepStrictEqual(util.parsePath('.foo.bar'), ['foo', 'bar']);
      assert.deepStrictEqual(util.parsePath('.foo[2]'), ['foo', 2]);
      assert.deepStrictEqual(util.parsePath('.foo[2].bar'), ['foo', 2, 'bar']);
      assert.deepStrictEqual(util.parsePath('.foo["prop with spaces"]'), ['foo', 'prop with spaces']);
      assert.deepStrictEqual(util.parsePath('.foo[\'prop with single quotes as outputted by ajv library\']'), ['foo', 'prop with single quotes as outputted by ajv library']);
      assert.deepStrictEqual(util.parsePath('.foo["prop with . dot"]'), ['foo', 'prop with . dot']);
      assert.deepStrictEqual(util.parsePath('.foo["prop with ] character"]'), ['foo', 'prop with ] character']);
      assert.deepStrictEqual(util.parsePath('.foo[*].bar'), ['foo', '*', 'bar']);
      assert.deepStrictEqual(util.parsePath('[2]'), [2]);
    });

    it ('should throw an exception in case of an invalid path', function () {
      assert.throws(function () {util.parsePath('.')}, /Invalid JSON path: property name expected at index 1/);
      assert.throws(function () {util.parsePath('[')}, /Invalid JSON path: unexpected end, character ] expected/);
      assert.throws(function () {util.parsePath('[]')}, /Invalid JSON path: array value expected at index 1/);
      assert.throws(function () {util.parsePath('.foo[  ]')}, /Invalid JSON path: array value expected at index 7/);
      assert.throws(function () {util.parsePath('.[]')}, /Invalid JSON path: property name expected at index 1/);
      assert.throws(function () {util.parsePath('["23]')}, /Invalid JSON path: unexpected end, character " expected/);
      assert.throws(function () {util.parsePath('.foo bar')}, /Invalid JSON path: unexpected character " " at index 4/);
    });

  });

  describe('getIndexForPosition', function () {
    var el = {
      value: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.\nUt enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.\nExcepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.'
    };

    it('happy flows - row and column in range', function () {
      assert.strictEqual(util.getIndexForPosition(el, 1, 1), 0);
      assert.strictEqual(util.getIndexForPosition(el, 2, 1), 124);
      assert.strictEqual(util.getIndexForPosition(el, 3, 8), 239);
      assert.strictEqual(util.getIndexForPosition(el, 4, 22), 356);
    });

    it('if range exceeds it should be considered as if it is last row or column length', function () {
      assert.strictEqual(util.getIndexForPosition(el, 1, 100000), 123);
      assert.strictEqual(util.getIndexForPosition(el, 100000, 1), 335);
      assert.strictEqual(util.getIndexForPosition(el, 100000, 100000), 445);
    });

    it('missing or wrong input sould return -1', function () {
      assert.strictEqual(util.getIndexForPosition(el), -1);
      assert.strictEqual(util.getIndexForPosition(el, undefined, 1), -1);
      assert.strictEqual(util.getIndexForPosition(el, 1, undefined), -1);
      assert.strictEqual(util.getIndexForPosition(el, -2, -2), -1);
    });

  });

  describe('get', function () {
    it('should get a nested property from an object', function () {
      var obj = {
        a: {
          b: 2
        },
        c: 3,
        d: null,
        e: undefined
      }

      assert.strictEqual(util.get(obj, ['a', 'b']), 2);
      assert.strictEqual(util.get(obj, ['c']), 3);
      assert.deepStrictEqual(util.get(obj, ['a']), { b: 2});
      assert.strictEqual(util.get(obj, ['a', 'foo']), undefined);
      assert.strictEqual(util.get(obj, ['a', 'foo', 'bar']), undefined);
      assert.strictEqual(util.get(obj, ['d']), null);
      assert.strictEqual(util.get(obj, ['d', 'foo', 'bar']), null);
      assert.strictEqual(util.get(obj, ['e']), undefined);
    })
  });

  describe('makeFieldTooltip', function () {
    it('should return empty string when the schema is missing all relevant fields', function () {
      assert.strictEqual(util.makeFieldTooltip({}), '')
      assert.strictEqual(util.makeFieldTooltip({additionalProperties: false}), '')
      assert.strictEqual(util.makeFieldTooltip(), '')
    });
  
    it('should make tooltips with only title', function () {
      assert.strictEqual(util.makeFieldTooltip({title: 'foo'}), 'foo');
    });

    it('should make tooltips with only description', function () {
      assert.strictEqual(util.makeFieldTooltip({description: 'foo'}), 'foo');
    });

    it('should make tooltips with only default', function () {
      assert.strictEqual(util.makeFieldTooltip({default: 'foo'}), 'Default\n"foo"');
    });

    it('should make tooltips with only examples', function () {
      assert.strictEqual(util.makeFieldTooltip({examples: ['foo', 'bar']}), 'Examples\n"foo"\n"bar"');
    });

    it('should make tooltips with title and description', function () {
      assert.strictEqual(util.makeFieldTooltip({title: 'foo', description: 'bar'}), 'foo\nbar');

      var longTitle = 'Lorem Ipsum Dolor';
      var longDescription = 'Duis id elit non ante gravida vestibulum non nec est. ' +
        'Proin vitae ligula at elit dapibus tempor. ' +
        'Etiam lacinia augue vel condimentum interdum. ';
      assert.strictEqual(
        util.makeFieldTooltip({title: longTitle, description: longDescription}),
        longTitle + '\n' + longDescription
      );
    });

    it('should make tooltips with title, description, and examples', function () {
      assert.strictEqual(
        util.makeFieldTooltip({title: 'foo', description: 'bar', examples: ['baz']}),
        'foo\nbar\n\nExamples\n"baz"',
      );
    });

    it('should make tooltips with title, description, default, and examples', function () {
      assert.strictEqual(
        util.makeFieldTooltip({title: 'foo', description: 'bar', default: 'bat', examples: ['baz']}),
        'foo\nbar\n\nDefault\n"bat"\n\nExamples\n"baz"',
      );
    });

    it('should handle empty fields', function () {
      assert.strictEqual(util.makeFieldTooltip({title: '', description: 'bar'}), 'bar');
      assert.strictEqual(util.makeFieldTooltip({title: 'foo', description: ''}), 'foo');
      assert.strictEqual(util.makeFieldTooltip({description: 'bar', examples: []}), 'bar');
      assert.strictEqual(util.makeFieldTooltip({description: 'bar', examples: ['']}), 'bar\n\nExamples\n""');
    });

    it('should internationalize "Defaults" correctly', function () {
      assert.strictEqual(util.makeFieldTooltip({default: 'foo'}, 'pt-BR'), 'Revelia\n"foo"');
    });

    it('should internationalize "Examples" correctly', function () {
      assert.strictEqual(util.makeFieldTooltip({examples: ['foo']}, 'pt-BR'), 'Exemplos\n"foo"');
    });
  });

  describe('getChildPaths', function () {
    it('should extract all child paths of an array containing objects', function () {
      var json = [
        { name: 'A', location: {latitude: 1, longitude: 2} },
        { name: 'B', location: {latitude: 1, longitude: 2} },
        { name: 'C', timestamp: 0 },
      ];

      assert.deepStrictEqual(util.getChildPaths(json), [
        '.location.latitude',
        '.location.longitude',
        '.name',
        '.timestamp',
      ])
    });

    it('should extract all child paths of an array containing objects, including objects', function () {
      var json = [
        { name: 'A', location: {latitude: 1, longitude: 2} },
        { name: 'B', location: {latitude: 1, longitude: 2} },
        { name: 'C', timestamp: 0 },
      ];

      assert.deepStrictEqual(util.getChildPaths(json, true), [
        '',
        '.location',
        '.location.latitude',
        '.location.longitude',
        '.name',
        '.timestamp',
      ])
    });

    it('should extract all child paths of an array containing values', function () {
      var json = [ 1, 2, 3 ];

      assert.deepStrictEqual(util.getChildPaths(json), [
        ''
      ])
    });

    it('should extract all child paths of a non-array', function () {
      assert.deepStrictEqual(util.getChildPaths({a: 2, b: {c: 3}}), [''])
      assert.deepStrictEqual(util.getChildPaths('foo'), [''])
      assert.deepStrictEqual(util.getChildPaths(123), [''])
    });
  })

  it('should test whether something is an object', function () {
    assert.strictEqual(util.isObject({}), true);
    assert.strictEqual(util.isObject(new Date()), true);
    assert.strictEqual(util.isObject([]), false);
    assert.strictEqual(util.isObject(2), false);
    assert.strictEqual(util.isObject(null), false);
    assert.strictEqual(util.isObject(undefined), false);
    assert.strictEqual(util.isObject(), false);
  });

  describe('sort', function () {
    it('should sort an array', function () {
      var array = [4, 1, 10, 2];
      assert.deepStrictEqual(util.sort(array), [1, 2, 4, 10]);
      assert.deepStrictEqual(util.sort(array, '.', 'desc'), [10, 4, 2, 1]);
    });

    it('should sort an array containing objects', function () {
      var array = [
        { value: 4 },
        { value: 1 },
        { value: 10 },
        { value: 2 }
      ];

      assert.deepStrictEqual(util.sort(array, '.value'), [
        { value: 1 },
        { value: 2 },
        { value: 4 },
        { value: 10 }
      ]);

      assert.deepStrictEqual(util.sort(array, '.value', 'desc'), [
        { value: 10 },
        { value: 4 },
        { value: 2 },
        { value: 1 }
      ]);
    });
  });

  describe('sortObjectKeys', function () {
    it('should sort the keys of an object', function () {
      var object = {
        c: 'c',
        a: 'a',
        b: 'b'
      }
      assert.strictEqual(JSON.stringify(object), '{"c":"c","a":"a","b":"b"}')
      assert.strictEqual(JSON.stringify(util.sortObjectKeys(object)), '{"a":"a","b":"b","c":"c"}')
      assert.strictEqual(JSON.stringify(util.sortObjectKeys(object, 'asc')), '{"a":"a","b":"b","c":"c"}')
      assert.strictEqual(JSON.stringify(util.sortObjectKeys(object, 'desc')), '{"c":"c","b":"b","a":"a"}')
    });
  });

  it('should parse a string', function () {
    assert.strictEqual(util.parseString('foo'), 'foo');
    assert.strictEqual(util.parseString('234foo'), '234foo');
    assert.strictEqual(util.parseString('2.3'), 2.3);
    assert.strictEqual(util.parseString('null'), null);
    assert.strictEqual(util.parseString('true'), true);
    assert.strictEqual(util.parseString('false'), false);
  })

  it('should find a unique name', function () {
    assert.strictEqual(util.findUniqueName('other', [
      'a',
      'b',
      'c'
    ]), 'other')

    assert.strictEqual(util.findUniqueName('b', [
      'a',
      'b',
      'c'
    ]), 'b (copy)')

    assert.strictEqual(util.findUniqueName('b', [
      'a',
      'b',
      'c',
      'b (copy)'
    ]), 'b (copy 2)')

    assert.strictEqual(util.findUniqueName('b', [
      'a',
      'b',
      'c',
      'b (copy)',
      'b (copy 2)'
    ]), 'b (copy 3)')

    assert.strictEqual(util.findUniqueName('b (copy)', [
      'a',
      'b',
      'b (copy)',
      'b (copy 2)',
      'c'
    ]), 'b (copy 3)')

    assert.strictEqual(util.findUniqueName('b (copy 2)', [
      'a',
      'b',
      'b (copy)',
      'b (copy 2)',
      'c'
    ]), 'b (copy 3)')
  })

  it('should format a document size in a human readable way', function () {
    assert.strictEqual(util.formatSize(500), '500 B');
    assert.strictEqual(util.formatSize(900), '0.9 KiB');
    assert.strictEqual(util.formatSize(77.89 * 1024), '77.9 KiB');
    assert.strictEqual(util.formatSize(950 * 1024), '0.9 MiB');
    assert.strictEqual(util.formatSize(7.22 * 1024 * 1024), '7.2 MiB');
    assert.strictEqual(util.formatSize(955.4 * 1024 * 1024), '0.9 GiB');
    assert.strictEqual(util.formatSize(22.37 * 1024 * 1024 * 1024), '22.4 GiB');
    assert.strictEqual(util.formatSize(1024  * 1024 * 1024 * 1024), '1.0 TiB');
  });

  it ('should limit characters', function () {
    assert.strictEqual(util.limitCharacters('hello world', 11), 'hello world');
    assert.strictEqual(util.limitCharacters('hello world', 5), 'hello...');
    assert.strictEqual(util.limitCharacters('hello world', 100), 'hello world');
  })

  it('should compile a JSON pointer', function () {
    assert.strictEqual(util.compileJSONPointer(['foo', 'bar']), '/foo/bar')
    assert.strictEqual(util.compileJSONPointer(['foo', '/~ ~/']), '/foo/~1~0 ~0~1')
    assert.strictEqual(util.compileJSONPointer(['']), '/')
    assert.strictEqual(util.compileJSONPointer([]), '')
  });

  // TODO: thoroughly test all util methods
});