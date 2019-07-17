'use strict';

var jmespath = require('jmespath');
var translate = require('./i18n').translate;
var ModeSwitcher = require('./ModeSwitcher');
var showSortModal = require('./showSortModal');
var showTransformModal = require('./showTransformModal');
var MAX_PREVIEW_CHARACTERS = require('./constants').MAX_PREVIEW_CHARACTERS;
var DEFAULT_MODAL_ANCHOR = require('./constants').DEFAULT_MODAL_ANCHOR;
var SIZE_LARGE = require('./constants').SIZE_LARGE;
var PREVIEW_HISTORY_LIMIT = require('./constants').PREVIEW_HISTORY_LIMIT;
var util = require('./util');
var History = require('./History');
var jsonUtils = require('./jsonUtils');

// create a mixin with the functions for text mode
var previewmode = {};

/**
 * Create a JSON document preview, suitable for processing of large documents
 * @param {Element} container
 * @param {Object} [options]   Object with options. See docs for details.
 * @private
 */
previewmode.create = function (container, options) {
  // read options
  options = options || {};
  
  if (typeof options.statusBar === 'undefined') {
    options.statusBar = true;
  }

  // setting default for previewmode
  options.mainMenuBar = options.mainMenuBar !== false;
  options.enableSort = options.enableSort !== false;
  options.enableTransform = options.enableTransform !== false;

  this.options = options;

  // indentation
  if (options.indentation) {
    this.indentation = Number(options.indentation);
  }
  else {
    this.indentation = 2; // number of spaces
  }

  // determine mode
  this.mode = 'preview';

  var me = this;
  this.container = container;
  this.dom = {};

  this.json = undefined;
  this.text = '';

  // TODO: JSON Schema support

  // create a debounced validate function
  this._debouncedValidate = util.debounce(this.validate.bind(this), this.DEBOUNCE_INTERVAL);

  this.width = container.clientWidth;
  this.height = container.clientHeight;

  this.frame = document.createElement('div');
  this.frame.className = 'jsoneditor jsoneditor-mode-preview';
  this.frame.onclick = function (event) {
    // prevent default submit action when the editor is located inside a form
    event.preventDefault();
  };

  this.content = document.createElement('div');
  this.content.className = 'jsoneditor-outer';

  this.dom.busy = document.createElement('div')
  this.dom.busy.className = 'jsoneditor-busy';
  this.dom.busyContent = document.createElement('span');
  this.dom.busyContent.innerHTML = 'busy...';
  this.dom.busy.appendChild(this.dom.busyContent);
  this.content.appendChild(this.dom.busy);

  this.dom.previewContent = document.createElement('pre');
  this.dom.previewContent.className = 'jsoneditor-preview';
  this.dom.previewText = document.createTextNode('');
  this.dom.previewContent.appendChild(this.dom.previewText);
  this.content.appendChild(this.dom.previewContent);

  if (this.options.mainMenuBar) {
    util.addClassName(this.content, 'has-main-menu-bar');

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
    buttonFormat.onclick = function handleFormat() {
      me.executeWithBusyMessage(function () {
        try {
          me.format();
        }
        catch (err) {
          me._onError(err);
        }
      }, 'formatting...');
    };

    // create compact button
    var buttonCompact = document.createElement('button');
    buttonCompact.type = 'button';
    buttonCompact.className = 'jsoneditor-compact';
    buttonCompact.title = 'Compact JSON data, remove all whitespaces (Ctrl+Shift+\\)';
    this.menu.appendChild(buttonCompact);
    buttonCompact.onclick = function handleCompact() {
      me.executeWithBusyMessage(function () {
        try {
          me.compact();
        }
        catch (err) {
          me._onError(err);
        }
      }, 'compacting...');
    };

    // create sort button
    if (this.options.enableSort) {
      var sort = document.createElement('button');
      sort.type = 'button';
      sort.className = 'jsoneditor-sort';
      sort.title = translate('sortTitleShort');
      sort.onclick = function () {
        me._showSortModal();
      };
      this.menu.appendChild(sort);
    }

    // create transform button
    if (this.options.enableTransform) {
      var transform = document.createElement('button');
      transform.type = 'button';
      transform.title = translate('transformTitleShort');
      transform.className = 'jsoneditor-transform';
      transform.onclick = function () {
        me._showTransformModal();
      };
      this.menu.appendChild(transform);
    }

    // create repair button
    var buttonRepair = document.createElement('button');
    buttonRepair.type = 'button';
    buttonRepair.className = 'jsoneditor-repair';
    buttonRepair.title = 'Repair JSON: fix quotes and escape characters, remove comments and JSONP notation, turn JavaScript objects into JSON.';
    this.menu.appendChild(buttonRepair);
    buttonRepair.onclick = function () {
      me.executeWithBusyMessage(function () {
        try {
          me.repair();
        }
        catch (err) {
          me._onError(err);
        }
      }, 'repairing...');
    };

    // create history and undo/redo buttons
    if (this.options.history !== false) { // default option value is true
      var onHistoryChange = function () {
        me.dom.undo.disabled = !me.history.canUndo();
        me.dom.redo.disabled = !me.history.canRedo();
      };

      var calculateItemSize = function (item) {
        return item.text.length * 2; // times two to account for the json object
      }

      this.history = new History(onHistoryChange, calculateItemSize, PREVIEW_HISTORY_LIMIT);

      // create undo button
      var undo = document.createElement('button');
      undo.type = 'button';
      undo.className = 'jsoneditor-undo jsoneditor-separator';
      undo.title = translate('undo');
      undo.onclick = function () {
        var action = me.history.undo();
        if (action) {
          me._applyHistory(action);
        }
      };
      this.menu.appendChild(undo);
      this.dom.undo = undo;

      // create redo button
      var redo = document.createElement('button');
      redo.type = 'button';
      redo.className = 'jsoneditor-redo';
      redo.title = translate('redo');
      redo.onclick = function () {
        var action = me.history.redo();
        if (action) {
          me._applyHistory(action);
        }
      };
      this.menu.appendChild(redo);
      this.dom.redo = redo;

      // force enabling/disabling the undo/redo button
      this.history.onChange();
    }

    // create mode box
    if (this.options && this.options.modes && this.options.modes.length) {
      this.modeSwitcher = new ModeSwitcher(this.menu, this.options.modes, this.options.mode, function onSwitch(mode) {
        // switch mode and restore focus
        me.setMode(mode);
        me.modeSwitcher.focus();
      });
    }
  }

  this.frame.appendChild(this.content);
  this.container.appendChild(this.frame);

  if (options.statusBar) {
    util.addClassName(this.content, 'has-status-bar');

    var statusBar = document.createElement('div');
    this.dom.statusBar = statusBar;
    statusBar.className = 'jsoneditor-statusbar';
    this.frame.appendChild(statusBar);

    this.dom.fileSizeInfo = document.createElement('span');
    this.dom.fileSizeInfo.className = 'jsoneditor-size-info';
    this.dom.fileSizeInfo.innerText = '';
    statusBar.appendChild(this.dom.fileSizeInfo);

    this.dom.arrayInfo = document.createElement('span');
    this.dom.arrayInfo.className = 'jsoneditor-size-info';
    this.dom.arrayInfo.innerText = '';
    statusBar.appendChild(this.dom.arrayInfo);
  }

  this._renderPreview();

  this.setSchema(this.options.schema, this.options.schemaRefs);  
};

previewmode._renderPreview = function () {
  var text = this.getText();

  this.dom.previewText.nodeValue = util.limitCharacters(text, MAX_PREVIEW_CHARACTERS);

  if (this.dom.fileSizeInfo) {
    this.dom.fileSizeInfo.innerText = 'Size: ' + util.formatSize(text.length);
  }

  if (this.dom.arrayInfo) {
    if (Array.isArray(this.json)) {
      this.dom.arrayInfo.innerText = ('Array: ' + this.json.length + ' items');
    }
    else if (jsonUtils.containsArray(this.text)) {
      var info = document.createElement('span');
      info.className = 'jsoneditor-array-info';
      var calculate = document.createElement('a');
      var me = this;
      calculate.appendChild(document.createTextNode('calculate number of items'));
      calculate.href = '#';
      calculate.onclick = function () {
        me.executeWithBusyMessage(function () {
          try {
            me.get();
            me._renderPreview();
          }
          catch (err) {
            me._onError(err);
          }
        }, 'parsing...');
      }
      info.appendChild(document.createTextNode('Array: '));
      info.appendChild(calculate);

      this.dom.arrayInfo.innerHTML = '';
      this.dom.arrayInfo.appendChild(info);
    }
    else {
      this.dom.arrayInfo.innerText = '';
    }

  }
};

/**
 * Handle a change:
 * - Validate JSON schema
 * - Send a callback to the onChange listener if provided
 * @private
 */
previewmode._onChange = function () {
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

  // trigger the onChangeJSON callback
  if (this.options.onChangeJSON) {
    try {
      this.options.onChangeJSON(this.get());
    }
    catch (err) {
      console.error('Error in onChangeJSON callback: ', err);
    }
  }

  // trigger the onChangeText callback
  if (this.options.onChangeText) {
    try {
      this.options.onChangeText(this.getText());
    }
    catch (err) {
      console.error('Error in onChangeText callback: ', err);
    }
  }
};

/**
 * Open a sort modal
 * @private
 */
previewmode._showSortModal = function () {
  var me = this;

  function onSort (json, sortedBy) {
    if (Array.isArray(json)) {
      var sortedArray = util.sort(json, sortedBy.path, sortedBy.direction);

      me.sortedBy = sortedBy
      me._setAndFireOnChange(sortedArray);
    }

    if (util.isObject(json)) {
      var sortedObject = util.sortObjectKeys(json, sortedBy.direction);

      me.sortedBy = sortedBy;
      me._setAndFireOnChange(sortedObject);
    }
  }

  this.executeWithBusyMessage(function () {
    var container = me.options.modalAnchor || DEFAULT_MODAL_ANCHOR;
    var json = me.get();
    me._renderPreview(); // update array count

    showSortModal(container, json, function (sortedBy) {
      me.executeWithBusyMessage(function () {
        onSort(json, sortedBy);
      }, 'sorting...');
    }, me.sortedBy)
  }, 'parsing...');
}

/**
 * Open a transform modal
 * @private
 */
previewmode._showTransformModal = function () {
  var me = this;

  this.executeWithBusyMessage(function () {
    var anchor = me.options.modalAnchor || DEFAULT_MODAL_ANCHOR;
    var json = me.get();
    me._renderPreview(); // update array count

    showTransformModal(anchor, json, function (query) {
      me.executeWithBusyMessage(function () {
        var updatedJson = jmespath.search(json, query);
        me._setAndFireOnChange(updatedJson);
      }, 'transforming...')
    })
  }, 'parsing...')
}

/**
 * Destroy the editor. Clean up DOM, event listeners, and web workers.
 */
previewmode.destroy = function () {
  if (this.frame && this.container && this.frame.parentNode === this.container) {
    this.container.removeChild(this.frame);
  }

  if (this.modeSwitcher) {
    this.modeSwitcher.destroy();
    this.modeSwitcher = null;
  }

  this._debouncedValidate = null;

  this.history.clear();
  this.history = null;
};

/**
 * Compact the code in the text editor
 */
previewmode.compact = function () {
  var json = this.get();
  var text = JSON.stringify(json);

  // we know that in this case the json is still the same, so we pass json too
  this._setTextAndFireOnChange(text, json);
};

/**
 * Format the code in the text editor
 */
previewmode.format = function () {
  var json = this.get();
  var text = JSON.stringify(json, null, this.indentation);

  // we know that in this case the json is still the same, so we pass json too
  this._setTextAndFireOnChange(text, json);
};

/**
 * Repair the code in the text editor
 */
previewmode.repair = function () {
  var text = this.getText();
  var sanitizedText = util.sanitize(text);

  this._setTextAndFireOnChange(sanitizedText);
};

/**
 * Set focus to the editor
 */
previewmode.focus = function () {
  // TODO: implement method focus
};

/**
 * Set json data in the editor
 * @param {*} json
 */
previewmode.set = function(json) {
  if (this.history) {
    this.history.clear();
  }

  this._set(json);
};

/**
 * Update data. Same as calling `set` in text/code mode.
 * @param {*} json
 */
previewmode.update = function(json) {
  this._set(json);
};

/**
 * Set json data
 * @param {*} json
 */
previewmode._set = function(json) {
  this.text = undefined;
  this.json = json;

  this._renderPreview();

  this._pushHistory();

  // validate JSON schema
  this._debouncedValidate();
};

previewmode._setAndFireOnChange = function (json) {
  this._set(json);
  this._onChange();
}

/**
 * Get json data
 * @return {*} json
 */
previewmode.get = function() {
  if (this.json === undefined) {
    var text = this.getText();

    try {
      console.time('parse') // TODO: cleanup
      this.json = util.parse(text); // this can throw an error
      console.timeEnd('parse') // TODO: cleanup
    }
    catch (err) {
      // try to sanitize json, replace JavaScript notation with JSON notation
      text = util.sanitize(text);

      // try to parse again
      this.json = util.parse(text); // this can throw an error
    }
  }

  return this.json;
};

/**
 * Get the text contents of the editor
 * @return {String} jsonText
 */
previewmode.getText = function() {
  if (this.text === undefined) {
    console.time('stringify') // TODO: cleanup
    this.text = JSON.stringify(this.json, null, this.indentation);
    console.timeEnd('stringify') // TODO: cleanup

    if (this.options.escapeUnicode === true) {
      console.time('escape') // TODO: cleanup
      this.text = util.escapeUnicodeChars(this.text);
      console.timeEnd('escape') // TODO: cleanup
    }
  }

  return this.text;
};

/**
 * Set the text contents of the editor
 * @param {String} jsonText
 */
previewmode.setText = function(jsonText) {
  if (this.history) {
    this.history.clear();
  }

  this._setText(jsonText);
};

/**
 * Update the text contents
 * @param {string} jsonText
 */
previewmode.updateText = function(jsonText) {
  // don't update if there are no changes
  if (this.getText() === jsonText) {
    return;
  }

  this._setText(jsonText);
};

/**
 * Set the text contents of the editor
 * @param {string} jsonText
 * @param {*} [json] Optional JSON instance of the text
 * @private
 */
previewmode._setText = function(jsonText, json) {
  if (this.options.escapeUnicode === true) {
    console.time('escape') // TODO: cleanup
    this.text = util.escapeUnicodeChars(jsonText);
    console.timeEnd('escape') // TODO: cleanup
  }
  else {
    this.text = jsonText;
  }
  this.json = json;

  this._renderPreview();

  this._pushHistory();

  this._debouncedValidate();
};

/**
 * Set text and fire onChange callback
 * @param {string} jsonText
 * @param {*} [json] Optional JSON instance of the text
 * @private
 */
previewmode._setTextAndFireOnChange = function (jsonText, json) {
  this._setText(jsonText, json);
  this._onChange();
}

/**
 * Apply history to the current state
 * @param {{json?: JSON, text?: string}} action
 * @private
 */
previewmode._applyHistory = function (action) {
  this.json = action.json;
  this.text = action.text;

  this._renderPreview();

  this._debouncedValidate();
};

/**
 * Push the current state to history
 * @private
 */
previewmode._pushHistory = function () {
  if (!this.history) {
    return;
  }

  var action = {
    text: this.text,
    json: this.json
  };

  this.history.add(action);
}

/**
 * Execute a heavy, blocking action.
 * Before starting the action, show a message on screen like "parsing..."
 * @param {function} fn
 * @param {string} message
 */
previewmode.executeWithBusyMessage = function (fn, message) {
  var size = this.getText().length;

  if (size > SIZE_LARGE) {
    var me = this;
    util.addClassName(me.frame, 'busy');
    me.dom.busyContent.innerText = message;

    setTimeout(function () {
      fn();
      util.removeClassName(me.frame, 'busy');
      me.dom.busyContent.innerText = '';
    }, 100);
  }
  else {
    fn();
  }
};

/**
 * Validate current JSON object against the configured JSON schema
 * Throws an exception when no JSON schema is configured
 */
previewmode.validate = function () {
  // FIXME: implement validate (also support custom validation)
};

// define modes
module.exports = [
  {
    mode: 'preview',
    mixin: previewmode,
    data: 'json'
  }
];