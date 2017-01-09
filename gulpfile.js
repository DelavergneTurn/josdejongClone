const path = require('path')
const fs = require('fs')
const gulp = require('gulp')
const gulpMultiProcess = require('gulp-multi-process')
const gutil = require('gulp-util')
const shell = require('gulp-shell')
const mkdirp = require('mkdirp')
const babel = require('gulp-babel')
const webpack = require('webpack')
const browserSync = require('browser-sync').create()

const WATCH = 'watch'
const WATCHING = process.argv[2] === WATCH

if (WATCHING) {
  gutil.log('Watching src/*.')
  gutil.log('The bundle ./dist/jsoneditor.js will be updated automatically  ')
  gutil.log('on changes in the source code this bundle will not be minified.')
  gutil.log('Also, ./dist/minimalist code is not updated on changes.')
}

const NAME = 'jsoneditor.js'
const NAME_MINIMALIST = 'jsoneditor-minimalist.js'
const NAME_REACT = 'jsoneditor-react.js'
const NAME_REACT_MINIMALIST = 'jsoneditor-react-minimalist.js'
const ENTRY = './src/index.js'
const ENTRY_REACT = './src/components/JSONEditor.js'
const HEADER = './src/header.js'
const DIST = path.resolve(__dirname, './dist')
const LIB = './lib'
const EMPTY = __dirname + '/src/utils/empty.js'

// generate banner with today's date and correct version
function createBanner() {
  const today = gutil.date(new Date(), 'yyyy-mm-dd') // today, formatted as yyyy-mm-dd
  const version = require('./package.json').version  // math.js version

  return String(fs.readFileSync(HEADER))
      .replace('@@date', today)
      .replace('@@version', version)
}

const bannerPlugin = new webpack.BannerPlugin({
  banner: createBanner(),
  entryOnly: true,
  raw: true
})

const minifyPlugin = new webpack.optimize.UglifyJsPlugin()

const excludeAcePlugin = new webpack.NormalModuleReplacementPlugin(new RegExp('/assets/ace$'), EMPTY)

const excludeAjvPlugin = new webpack.NormalModuleReplacementPlugin(new RegExp('^ajv$'), EMPTY)

const productionEnvPlugin = new webpack.DefinePlugin({
  'process.env': {
    NODE_ENV: JSON.stringify('production')
  }
})

const rules = [
  {test: /\.js$/, exclude: /node_modules/, loader: 'babel-loader'},
  { test: /\.json$/, loader: 'json-loader' },
  {
    test: /\.less$/,
    loaders: ['style-loader', 'css-loader', 'less-loader'],
  },
  {test: /\.svg$/, loader: 'svg-url-loader'},
]

// create a single instance of the compiler to allow caching
const compiler = webpack({
  entry: ENTRY,
  devtool: 'source-map',
  cache: true,
  bail: true,
  output: {
    library: 'jsoneditor',
    libraryTarget: 'umd',
    path: DIST,
    filename: NAME
  },
  plugins: WATCHING
      ? [bannerPlugin]
      : [bannerPlugin, productionEnvPlugin, minifyPlugin],
  module: {
    rules
  }
})

// create a single instance of the compiler to allow caching
const compilerMinimalist = webpack({
  entry: ENTRY,
  devtool: 'source-map',
  cache: true,
  output: {
    library: 'jsoneditor',
    libraryTarget: 'umd',
    path: DIST,
    filename: NAME_MINIMALIST
  },
  plugins: [
    bannerPlugin,
    productionEnvPlugin,
    excludeAcePlugin,
    excludeAjvPlugin,
    minifyPlugin
  ],
  module: {
    rules
  }
})

const externals = {
  'react': 'commonjs react'
}

// FIXME: get the react bundles working
// create a single instance of the compiler to allow caching
const compilerReact = webpack({
  entry: ENTRY_REACT,
  devtool: 'source-map',
  cache: true,
  bail: true,
  output: {
    path: DIST,
    filename: NAME_REACT
  },
  plugins: [
    bannerPlugin,
    productionEnvPlugin,
    minifyPlugin
  ],
  module: {
    rules
  },
  externals
})

// FIXME: get the react bundles working
// create a single instance of the compiler to allow caching
const compilerReactMinimalist = webpack({
  entry: ENTRY_REACT,
  devtool: 'source-map',
  cache: true,
  bail: true,
  output: {
    path: DIST,
    filename: NAME_REACT_MINIMALIST
  },
  plugins: [
    bannerPlugin,
    productionEnvPlugin,
    excludeAcePlugin,
    excludeAjvPlugin,
    minifyPlugin
  ],
  module: {
    rules
  },
  externals
})

function handleCompilerCallback(err, stats) {
  if (err) {
    gutil.log(err.toString())
  }

  if (stats && stats.compilation && stats.compilation.errors) {
    // output soft errors
    stats.compilation.errors.forEach(function (err) {
      gutil.log(err.toString())
    })
  }
}

function createBundleTask(compiler) {
  return function (done) {
    // update the banner contents (has a date in it which should stay up to date)
    bannerPlugin.banner = createBanner()

    compiler.run(function (err, stats) {
      handleCompilerCallback(err, stats)

      done()
    })
  }
}

// make dist folder
gulp.task('mkdir', function () {
  mkdirp.sync(DIST)
  mkdirp.sync(LIB)
})

// bundle javascript
gulp.task('bundle', ['mkdir'], createBundleTask(compiler))

// bundle minimalist version of javascript
gulp.task('bundle-minimalist', ['mkdir'], createBundleTask(compilerMinimalist))

// compile the source code into es5 code
gulp.task('compile-es5-lib', ['mkdir'], function () {
  // TODO: compile *.less too
  return gulp
      .src([
        'src/**/*.js',
        '!src/flow/**/*.js',
        '!src/resources/**/*.js'
      ])
      .pipe(babel())
      .pipe(gulp.dest(LIB));
})

// bundle react version
// TODO: remove bundle-react again? (use ./lib instead)
gulp.task('bundle-react', ['mkdir'], createBundleTask(compilerReact))

// bundle react minimalist version
// TODO: remove bundle-react-minimalist again? (use ./lib instead)
gulp.task('bundle-react-minimalist', ['mkdir'], createBundleTask(compilerReactMinimalist))

// TODO: zip file using archiver
const pkg = 'jsoneditor-' + require('./package.json').version + '.zip'
gulp.task('zip', shell.task([
  'zip ' + pkg + ' ' + 'README.md LICENSE HISTORY.md index.html src dist docs examples -r '
]))

// execute all tasks and reload the browser afterwards
gulp.task('bundle-and-reload', ['bundle'], function (done) {
  browserSync.reload();

  done();
});

// The watch task (to automatically rebuild when the source code changes)
// Does only generate jsoneditor.js and jsoneditor.css, and copy the image
// Does NOT minify the code and does NOT generate the minimalist version
gulp.task(WATCH, ['bundle'], function () {
  browserSync.init({
    open: 'local',
    server: '.',
    startPath: '/src/develop.html',
    minify: false
  })

  gulp.watch('src/**/*', ['bundle-and-reload'])
})
// The default task (called when you run `gulp`)
gulp.task('default', function (done) {
  return gulpMultiProcess([
    'bundle',
    'bundle-minimalist',
    'compile-es5-lib'
  ], done);
})
