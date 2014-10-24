/****************************************************************************
 The MIT License (MIT)

 Copyright (c) 2014 Apigee Corporation

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in
 all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 THE SOFTWARE.
 ****************************************************************************/
'use strict';

var should = require('should');
var util = require('util');
var config = require('../../../config');
var path = require('path');
var proxyquire =  require('proxyquire');
var tmp = require('tmp');
var fs = require('fs');
var yaml = require('yamljs');
var helpers = require('../../helpers');

/*
 create: create,
 start: start,
 verify: verify,
 edit: edit,
 open: open,
 docs: docs,
 deploy: deploy,
 undeploy: undeploy,
 showConfig: showConfig,
 downloadSkeleton: downloadSkeleton
 */

describe('project', function() {

  var tmpDir;
  var spawn = {};

  var orginalAccountFile = config.account.file;

  before(function(done) {
    tmp.setGracefulCleanup();

    // set up account
    tmp.file(function(err, tmpFile) {
      should.not.exist(err);
      config.account.file = tmpFile;
      var sourceFile = path.join(__dirname, '..', 'account', 'accounts.json');
      helpers.copyFile(sourceFile, tmpFile, function() {

        // set up project dir
        tmp.dir({ unsafeCleanup: true }, function(err, path) {
          should.not.exist(err);
          tmpDir = path;
          process.chdir(tmpDir);
          done();
        });
      });
    });
  });

  after(function() {
    config.account.file = orginalAccountFile;
  });

  var nodemonOpts = {};
  var projectStubs = {
    'child_process': {
      spawn: function(command, args, options) {
        spawn.command = command;
        spawn.args = args;
        spawn.options = options;

        var ret = {};
        ret.stdout = {
          on: function() {}
        };
        ret.stderr = {
          on: function() {}
        };
        ret.on = function(name, cb) {
          if (name === 'close') {
            setTimeout(function() { cb(0); }, 0);
          }
          return ret;
        };
        return ret;
      }
    },
    'nodemon': {
      on: function(name, cb) {
        if (name === 'start') {
          setTimeout(function() { cb(); nodemonOpts.cb(); }, 0);
        }
        return this;
      },
      _init: function(opts, cb) {
        nodemonOpts = opts;
        nodemonOpts.cb = cb;
      },
      '@noCallThru': true
    }
  };
  var project = proxyquire('../../../lib/commands/project/project', projectStubs);

  describe('create', function() {

    it('should err if project directory already exists', function(done) {
      var name = 'create_err';
      var projPath = path.resolve(tmpDir, name);
      fs.mkdirSync(projPath);
      project.create(name, {}, function(err) {
        should.exist(err);
        done();
      });
    });

    it('should create a new project', function(done) {
      var name = 'create';
      var projPath = path.resolve(tmpDir, name);
      project.create(name, {}, function(err) {
        should.not.exist(err);
        var packageJson = path.resolve(projPath, 'package.json');
        // check a couple of files
        fs.existsSync(packageJson).should.be.ok;
        fs.existsSync(path.resolve(projPath, 'node_modules')).should.not.be.ok;

        // check spawn `npm install`
        spawn.command.should.equal('npm');
        spawn.args.should.containEql('install');
        spawn.options.should.have.property('cwd', fs.realpathSync(projPath));

        // check customizeClonedFiles
        fs.readFile(packageJson, { encoding: 'utf8' }, function(err, string) {
          if (err) { return cb(err); }
          var project = JSON.parse(string);
          project.api.name.should.equal(name);
          done();
        });
      });
    });
  });

  describe('start', function() {

    var name = 'start';
    var projPath;

    before(function(done) {
      projPath = path.resolve(tmpDir, name);
      project.create(name, {}, function(err) {
        should.not.exist(err);
        done();
      });
    });

    it('should pass debug debug options', function(done) {
      var options = { debug: 'true,test' };
      project.start(projPath, options, function(err) {
        should.not.exist(err);
        nodemonOpts.nodeArgs.should.containDeep('--debug=' + options.debug);
        done();
      });
    });

    it('should start in debug break mode', function(done) {
      var options = { debugBrk: true };
      project.start(projPath, options, function(err) {
        should.not.exist(err);
        nodemonOpts.nodeArgs.should.containDeep('--debug-brk');
        done();
      });
    });

    describe('writeConfig', function() {

      var options = {
        mock: true,
        debug: 'true,test',
        account: 'apigee'
      };
      var projectValues;

//      before(function(done) {
//        project.read(projPath, options, function(err, vals) {
//          projectValues = vals;
//          done();
//        });
//      });
//
      it('should write config files', function(done) {

        project.start(projPath, options, function(err) {
          should.not.exist(err);

          var envFile = path.join(projPath, 'config', '.a127_env');
          var env = fs.readFileSync(envFile, { encoding: 'utf8' });
          env.should.equal(options.account);

          var secretsFile = path.join(projPath, 'config', '.a127_secrets');
          var secrets = yaml.parse(fs.readFileSync(secretsFile, { encoding: 'utf8' }));

          secrets['_a127_start_config'].debug.should.equal(options.debug);
          secrets['_a127_start_config'].mock.should.equal(options.mock);

          secrets['name'].should.equal(options.account);
          // todo: check config print

          done();
        });
      });

      describe('print option', function() {
        var oldWrite;
        var logged = '';

        before(function() {
          oldWrite = process.stdout.write;
          process.stdout.write = (function(write) {
            return function(string, encoding, fd) {
              var args = Array.prototype.slice.call(arguments);
              logged += string;
            };
          }(process.stdout.write));
        });

        after(function() {
          process.stdout.write = oldWrite;
        });

        it('should emit config', function(done) {

          var options = {
            account: 'local',
            print: true
          };
          project.start(projPath, options, function(err) {
            should.not.exist(err);

            var secretsFile = path.join(projPath, 'config', '.a127_secrets');
            var secrets = yaml.parse(fs.readFileSync(secretsFile, { encoding: 'utf8' }));
            logged.should.containDeep(yaml.stringify(secrets));
            done();
          })
        })

      });
    });
  });

});
