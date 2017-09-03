'use strict';

var ace = require('./ace');
var ModeSwitcher = require('./ModeSwitcher');
var util = require('./util');

// create a mixin with the functions for text mode
var textmode = {};

var MAX_ERRORS = 3; // maximum number of displayed errors at the bottom

var DEFAULT_THEME = 'ace/theme/jsoneditor';

/**
 * Create a text editor
 * @param {Element} container
 * @param {Object} [options]   Object with options. available options:
 *                             {String} mode             Available values:
 *                                                       "text" (default)
 *                                                       or "code".
 *                             {Number} indentation      Number of indentation
 *                                                       spaces. 2 by default.
 *                             {function} onChange       Callback method
 *                                                       triggered on change
 *                             {function} onModeChange   Callback method
 *                                                       triggered after setMode
 *                             {function} onEditable     Determine if textarea is readOnly
 *                                                       readOnly defaults true
 *                             {Object} ace              A custom instance of
 *                                                       Ace editor.
 *                             {boolean} escapeUnicode   If true, unicode
 *                                                       characters are escaped.
 *                                                       false by default.
 * @private
 */
textmode.create = function (container, options) {
  // read options
  options = options || {};
  this.options = options;

  // indentation
  if (options.indentation) {
    this.indentation = Number(options.indentation);
  }
  else {
    this.indentation = 2; // number of spaces
  }

  // grab ace from options if provided
  var _ace = options.ace ? options.ace : ace;
  // TODO: make the option options.ace deprecated, it's not needed anymore (see #309)

  // determine mode
  this.mode = (options.mode == 'code') ? 'code' : 'text';
  if (this.mode == 'code') {
    // verify whether Ace editor is available and supported
    if (typeof _ace === 'undefined') {
      this.mode = 'text';
      console.warn('Failed to load Ace editor, falling back to plain text mode. Please use a JSONEditor bundle including Ace, or pass Ace as via the configuration option `ace`.');
    }
  }

  // determine theme
  this.theme = options.theme || DEFAULT_THEME;
  if (this.theme === DEFAULT_THEME && _ace) {
    try {
      require('./ace/theme-jsoneditor');
    }
    catch (err) {
      console.error(err);
    }
  }

  var me = this;
  this.container = container;
  this.dom = {};
  this.aceEditor = undefined;  // ace code editor
  this.textarea = undefined;  // plain text editor (fallback when Ace is not available)
  this.validateSchema = null;
  this.curserInfoElements = {};

  // create a debounced validate function
  this._debouncedValidate = util.debounce(this.validate.bind(this), this.DEBOUNCE_INTERVAL);

  this.width = container.clientWidth;
  this.height = container.clientHeight;

  this.frame = document.createElement('div');
  this.frame.className = 'jsoneditor jsoneditor-mode-' + this.options.mode;
  this.frame.onclick = function (event) {
    // prevent default submit action when the editor is located inside a form
    event.preventDefault();
  };
  this.frame.onkeydown = function (event) {
    me._onKeyDown(event);
  };

  // create menu
  this.menu = document.createElement('div');
  this.menu.className = 'jsoneditor-menu';
  this.frame.appendChild(this.menu);

  // create format button
  var buttonFormat = document.createElement('button');
  buttonFormat.type = 'button';
  buttonFormat.className = 'jsoneditor-format';
  buttonFormat.title = 'Format JSON data, with proper indentation and line feeds (Ctrl+\\)';
  this.menu.appendChild(buttonFormat);
  buttonFormat.onclick = function () {
    try {
      me.format();
      me._onChange();
    }
    catch (err) {
      me._onError(err);
    }
  };

  // create compact button
  var buttonCompact = document.createElement('button');
  buttonCompact.type = 'button';
  buttonCompact.className = 'jsoneditor-compact';
  buttonCompact.title = 'Compact JSON data, remove all whitespaces (Ctrl+Shift+\\)';
  this.menu.appendChild(buttonCompact);
  buttonCompact.onclick = function () {
    try {
      me.compact();
      me._onChange();
    }
    catch (err) {
      me._onError(err);
    }
  };

  // create mode box
  if (this.options && this.options.modes && this.options.modes.length) {
    this.modeSwitcher = new ModeSwitcher(this.menu, this.options.modes, this.options.mode, function onSwitch(mode) {
      // switch mode and restore focus
      me.setMode(mode);
      me.modeSwitcher.focus();
    });
  }

  // create curser and count info
  var curserAndCountInfo = document.createElement('div');
  curserAndCountInfo.className = 'jsoneditor-curserinfo';
  this.menu.appendChild(curserAndCountInfo);

  var emptyNode = {};
  var isReadOnly = (this.options.onEditable
  && typeof(this.options.onEditable === 'function')
  && !this.options.onEditable(emptyNode));

  this.content = document.createElement('div');
  this.content.className = 'jsoneditor-outer';
  this.frame.appendChild(this.content);

  this.container.appendChild(this.frame);

  if (this.mode == 'code') {
    this.editorDom = document.createElement('div');
    this.editorDom.style.height = '100%'; // TODO: move to css
    this.editorDom.style.width = '100%'; // TODO: move to css
    this.content.appendChild(this.editorDom);

    var aceEditor = _ace.edit(this.editorDom);
    aceEditor.$blockScrolling = Infinity;
    aceEditor.setTheme(this.theme);
    aceEditor.setOptions({ readOnly: isReadOnly });
    aceEditor.setShowPrintMargin(false);
    aceEditor.setFontSize(13);
    aceEditor.getSession().setMode('ace/mode/json');
    aceEditor.getSession().setTabSize(this.indentation);
    aceEditor.getSession().setUseSoftTabs(true);
    aceEditor.getSession().setUseWrapMode(true);
    aceEditor.commands.bindKey('Ctrl-L', null);    // disable Ctrl+L (is used by the browser to select the address bar)
    aceEditor.commands.bindKey('Command-L', null); // disable Ctrl+L (is used by the browser to select the address bar)
    this.aceEditor = aceEditor;

    // TODO: deprecated since v5.0.0. Cleanup backward compatibility some day
    if (!this.hasOwnProperty('editor')) {
      Object.defineProperty(this, 'editor', {
        get: function () {
          console.warn('Property "editor" has been renamed to "aceEditor".');
          return me.aceEditor;
        },
        set: function (aceEditor) {
          console.warn('Property "editor" has been renamed to "aceEditor".');
          me.aceEditor = aceEditor;
        }
      });
    }

    var lnLabel = document.createElement('span');
    lnLabel.className = 'jsoneditor-curserinfo-label';
    lnLabel.innerText = 'Ln:';

    var lnVal = document.createElement('span');
    lnVal.className = 'jsoneditor-curserinfo-val';
    lnVal.innerText = 0;

    curserAndCountInfo.appendChild(lnLabel);
    curserAndCountInfo.appendChild(lnVal);

    var colLabel = document.createElement('span');
    colLabel.className = 'jsoneditor-curserinfo-label';
    colLabel.innerText = 'Col:';

    var colVal = document.createElement('span');
    colVal.className = 'jsoneditor-curserinfo-val';
    colVal.innerText = 0;

    curserAndCountInfo.appendChild(colLabel);
    curserAndCountInfo.appendChild(colVal);

    this.curserInfoElements.colVal = colVal;
    this.curserInfoElements.lnVal = lnVal;

    var poweredBy = document.createElement('a');
    poweredBy.appendChild(document.createTextNode('powered by ace'));
    poweredBy.href = 'http://ace.ajax.org';
    poweredBy.target = '_blank';
    poweredBy.className = 'jsoneditor-poweredBy';
    poweredBy.onclick = function () {
      // TODO: this anchor falls below the margin of the content,
      // therefore the normal a.href does not work. We use a click event
      // for now, but this should be fixed.
      window.open(poweredBy.href, poweredBy.target);
    };
    this.menu.appendChild(poweredBy);

    // register onchange event
    aceEditor.on('change', this._onChange.bind(this));
    aceEditor.on('changeSelection', this._onSelect.bind(this));
  }
  else {
    // load a plain text textarea
    var textarea = document.createElement('textarea');
    textarea.className = 'jsoneditor-text';
    textarea.spellcheck = false;
    this.content.appendChild(textarea);
    this.textarea = textarea;
    this.textarea.readOnly = isReadOnly;

    // register onchange event
    if (this.textarea.oninput === null) {
      this.textarea.oninput = this._onChange.bind(this);
    }
    else {
      // oninput is undefined. For IE8-
      this.textarea.onchange = this._onChange.bind(this);
    }

    textarea.onselect = this._onSelect.bind(this);
    textarea.onmousedown = this._onMouseDown.bind(this);
    textarea.onblur = this._onBlur.bind(this);
  }

  var countLabel = document.createElement('span');
  countLabel.className = 'jsoneditor-curserinfo-label';
  countLabel.innerText = 'selected';
  countLabel.style.display = 'none';

  var countVal = document.createElement('span');
  countVal.className = 'jsoneditor-curserinfo-count';
  countVal.innerText = 0;
  countVal.style.display = 'none';

  this.curserInfoElements.countLabel = countLabel;
  this.curserInfoElements.countVal = countVal;

  curserAndCountInfo.appendChild(countVal);
  curserAndCountInfo.appendChild(countLabel);

  this.setSchema(this.options.schema, this.options.schemaRefs);
};

/**
 * Handle a change:
 * - Validate JSON schema
 * - Send a callback to the onChange listener if provided
 * @private
 */
textmode._onChange = function () {
  // validate JSON schema (if configured)
  this._debouncedValidate();

  // trigger the onChange callback
  if (this.options.onChange) {
    try {
      this.options.onChange();
    }
    catch (err) {
      console.error('Error in onChange callback: ', err);
    }
  }
};

/**
 * Handle text selection
 * Calculates the cursor position and selection range and updates menu
 * @private
 */
textmode._onSelect = function () {
  var selectionRange = {};
    
  if (this.textarea) {    
    selectionRange = util.getInputSelection(this.textarea);
  } else if (this.aceEditor) {
    var curserPos = this.aceEditor.getCursorPosition();
    var selectedText = this.aceEditor.getSelectedText();
    this.curserInfoElements.lnVal.innerText = curserPos.row + 1;
    this.curserInfoElements.colVal.innerText = curserPos.column + 1;
    this._setSelectionCountDisplay(selectedText.length);
  }

  if (selectionRange.start !== selectionRange.end) {
    this._setSelectionCountDisplay(Math.abs(selectionRange.end - selectionRange.start));
  }
};

/**
 * Event handler for keydown. Handles shortcut keys
 * @param {Event} event
 * @private
 */
textmode._onKeyDown = function (event) {
  var keynum = event.which || event.keyCode;
  var handled = false;

  if (keynum == 220 && event.ctrlKey) {
    if (event.shiftKey) { // Ctrl+Shift+\
      this.compact();
      this._onChange();
    }
    else { // Ctrl+\
      this.format();
      this._onChange();
    }
    handled = true;
  }

  if (handled) {
    event.preventDefault();
    event.stopPropagation();
  }

  this._setSelectionCountDisplay();
};

/**
 * Event handler for mousedown.
 * @param {Event} event
 * @private
 */
textmode._onMouseDown = function (event) {
  this._setSelectionCountDisplay();
};

/**
 * Event handler for blur.
 * @param {Event} event
 * @private
 */
textmode._onBlur = function (event) {
  this._setSelectionCountDisplay();
};

textmode._setSelectionCountDisplay = function (value) {
  if(value && this.curserInfoElements.countVal) {
    this.curserInfoElements.countVal.innerText = value;
    this.curserInfoElements.countVal.style.display = 'inline';
    this.curserInfoElements.countLabel.style.display = 'inline';
  } else {
    this.curserInfoElements.countVal.style.display = 'none';
    this.curserInfoElements.countLabel.style.display = 'none';
  }
};

/**
 * Destroy the editor. Clean up DOM, event listeners, and web workers.
 */
textmode.destroy = function () {
  // remove old ace editor
  if (this.aceEditor) {
    this.aceEditor.destroy();
    this.aceEditor = null;
  }

  if (this.frame && this.container && this.frame.parentNode == this.container) {
    this.container.removeChild(this.frame);
  }

  if (this.modeSwitcher) {
    this.modeSwitcher.destroy();
    this.modeSwitcher = null;
  }

  this.textarea = null;
  
  this._debouncedValidate = null;
};

/**
 * Compact the code in the formatter
 */
textmode.compact = function () {
  var json = this.get();
  var text = JSON.stringify(json);
  this.setText(text);
};

/**
 * Format the code in the formatter
 */
textmode.format = function () {
  var json = this.get();
  var text = JSON.stringify(json, null, this.indentation);
  this.setText(text);
};

/**
 * Set focus to the formatter
 */
textmode.focus = function () {
  if (this.textarea) {
    this.textarea.focus();
  }
  if (this.aceEditor) {
    this.aceEditor.focus();
  }
};

/**
 * Resize the formatter
 */
textmode.resize = function () {
  if (this.aceEditor) {
    var force = false;
    this.aceEditor.resize(force);
  }
};

/**
 * Set json data in the formatter
 * @param {Object} json
 */
textmode.set = function(json) {
  this.setText(JSON.stringify(json, null, this.indentation));
};

/**
 * Get json data from the formatter
 * @return {Object} json
 */
textmode.get = function() {
  var text = this.getText();
  var json;

  try {
    json = util.parse(text); // this can throw an error
  }
  catch (err) {
    // try to sanitize json, replace JavaScript notation with JSON notation
    text = util.sanitize(text);

    // try to parse again
    json = util.parse(text); // this can throw an error
  }

  return json;
};

/**
 * Get the text contents of the editor
 * @return {String} jsonText
 */
textmode.getText = function() {
  if (this.textarea) {
    return this.textarea.value;
  }
  if (this.aceEditor) {
    return this.aceEditor.getValue();
  }
  return '';
};

/**
 * Set the text contents of the editor
 * @param {String} jsonText
 */
textmode.setText = function(jsonText) {
  var text;

  if (this.options.escapeUnicode === true) {
    text = util.escapeUnicodeChars(jsonText);
  }
  else {
    text = jsonText;
  }

  if (this.textarea) {
    this.textarea.value = text;
  }
  if (this.aceEditor) {
    // prevent emitting onChange events while setting new text
    var originalOnChange = this.options.onChange;
    this.options.onChange = null;

    this.aceEditor.setValue(text, -1);

    this.options.onChange = originalOnChange;
  }
  // validate JSON schema
  this.validate();
};

/**
 * Validate current JSON object against the configured JSON schema
 * Throws an exception when no JSON schema is configured
 */
textmode.validate = function () {
  // clear all current errors
  if (this.dom.validationErrors) {
    this.dom.validationErrors.parentNode.removeChild(this.dom.validationErrors);
    this.dom.validationErrors = null;

    this.content.style.marginBottom = '';
    this.content.style.paddingBottom = '';
  }

  var doValidate = false;
  var errors = [];
  var json;
  try {
    json = this.get(); // this can fail when there is no valid json
    doValidate = true;
  }
  catch (err) {
    // no valid JSON, don't validate
  }

  // only validate the JSON when parsing the JSON succeeded
  if (doValidate && this.validateSchema) {
    var valid = this.validateSchema(json);
    if (!valid) {
      errors = this.validateSchema.errors.map(function (error) {
        return util.improveSchemaError(error);
      });
    }
  }

  if (errors.length > 0) {  
    // limit the number of displayed errors
    var limit = errors.length > MAX_ERRORS;
    if (limit) {
      errors = errors.slice(0, MAX_ERRORS);
      var hidden = this.validateSchema.errors.length - MAX_ERRORS;
      errors.push('(' + hidden + ' more errors...)')
    }

    var validationErrors = document.createElement('div');
    validationErrors.innerHTML = '<table class="jsoneditor-text-errors">' +
        '<tbody>' +
        errors.map(function (error) {
          var message;
          if (typeof error === 'string') {
            message = '<td colspan="2"><pre>' + error + '</pre></td>';
          }
          else {
            message = '<td>' + error.dataPath + '</td>' +
                '<td>' + error.message + '</td>';
          }

          return '<tr><td><button class="jsoneditor-schema-error"></button></td>' + message + '</tr>'
        }).join('') +
        '</tbody>' +
        '</table>';

    this.dom.validationErrors = validationErrors;
    this.frame.appendChild(validationErrors);

    var height = validationErrors.clientHeight;
    this.content.style.marginBottom = (-height) + 'px';
    this.content.style.paddingBottom = height + 'px';
  }

  // update the height of the ace editor
  if (this.aceEditor) {
    var force = false;
    this.aceEditor.resize(force);
  }
};

// define modes
module.exports = [
  {
    mode: 'text',
    mixin: textmode,
    data: 'text',
    load: textmode.format
  },
  {
    mode: 'code',
    mixin: textmode,
    data: 'text',
    load: textmode.format
  }
];