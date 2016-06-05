/*jslint node: true, regexp: true */

'use strict';

var assign = require('object-assign'),
    async = require('async'),
    fs = require('fs'),
    gutil = require('gulp-util'),
    mkdirp = require('mkdirp'),
    path = require('path'),
    rimraf = require('rimraf'),
    semver = require('semver'),
    spawn = require('child_process').spawn,
    through = require('through2');

module.exports = function (options) {
    var self, files = [],
        repoPath = path.normalize(path.join(process.cwd(), 'deploy-' + Date.now() + '-' + (Math.floor(Math.random() * 1000))));

    options = assign({}, {
        debug: false,
        prefix: '',
        release: false,
        repository: ''
    }, options);
    options.prefix = options.prefix.replace('/', path.sep);
    if (options.bumpVersion === undefined) {
        options.bumpVersion = options.release;
    }

    function gitCmd(cb, version, params, path) {
        var cmdGit, stdout = '', stderr = '';
        if (options.debug) {
            gutil.log(gutil.colors.yellow('Processing git command: git '  + params.join(' ')));
        }    
        
        if (path == null) {
            cmdGit = spawn('git', params);    
        } else {
            cmdGit = spawn('git', params, path);
        }
        
        cmdGit.stdout.on('data', function (buf) {
            stdout += buf;
        });
        cmdGit.stderr.on('data', function (buf) {
            stderr += buf;
        });
        cmdGit.on('close', function (code) {
            if (stdout != '' && options.debug) {
                gutil.log(gutil.colors.yellow(stdout));
            }
            
            if (code !== 0) {
                cb('git push exited with code ' + code + ' [stderr]: ' + stderr);
            } else {
                cb(null, version);
            }                    
        });        
    }
    
    return through.obj(function (file, enc, callback) {
        var p = path.normalize(path.relative(file.cwd, file.path));
        self = this;
        if (options.prefix.length > 0 && p.indexOf(options.prefix) === 0) {
            p = p.substr(options.prefix.length + 1);
        }
        files.push({
            source: file.path,
            destination: path.join(repoPath, p)
        });
        callback(null);
    },

    function (callback) {
        async.waterfall([
            function getVersionTag(cb) {
                var bowerJson, packageJson, version, cmdRevParse, sha1,
                    preReleaseVersion = 'build.' + process.env.BUILD_NUMBER || 'beta';

                if (fs.existsSync('bower.json')) {
                    bowerJson = JSON.parse(fs.readFileSync('bower.json'));
                    version = bowerJson.version;
                }

                if (!fs.existsSync('bower.json') && fs.existsSync('package.json')) {
                    packageJson = JSON.parse(fs.readFileSync('package.json'));
                    version = packageJson.version;
                }

                if (!fs.existsSync('bower.json') && !fs.existsSync('package.json')) {
                    cb('no.version');
                    return;
                }

                if (!options.release) {
                    cmdRevParse = spawn('git', ['rev-parse', '--short', 'HEAD']);
                    
                    gutil.log(gutil.colors.yellow('Fetching SHA hashes'));

                    var stderr = '';
                    
                    cmdRevParse.stdout.on('data', function(data) {
                        sha1 = data.toString().trim();
                    });
                    
                    cmdRevParse.stderr.on('data', function(buf) {
                        stderr += buf;
                    });

                    cmdRevParse.on('close', function (code) {
                        if (code !== 0) {
                            cb('git rev-parse exited with code ' + code + ' [stderr]: ' + stderr);
                        } else {
                            cb(null, version + '-' + preReleaseVersion + '+sha.' + sha1);
                        }
                    });
                } else {
                    cb(null, version);
                }
            },
            function cloneDistributionRepository(version, cb) {
                gutil.log(gutil.colors.yellow('Cloning distribution repository ' + options.repository));
                var params = ['clone', '-b', 'master', '--single-branch', options.repository, repoPath]; 
                gitCmd(cb, version, params);

            },
            function removeExistingFiles(version, cb) {
                var clean = function (folder) {
                    fs.readdirSync(folder).forEach(function (file) {
                        var filePath = path.normalize(path.join(folder, file)),
                            stats = fs.lstatSync(filePath);
                        if (stats.isDirectory()) {
                            if (file !== '.git') {
                                clean(filePath, callback);
                            }
                            return;
                        }
                        fs.unlinkSync(filePath);
                    });
                };
                gutil.log(gutil.colors.yellow('Cleaning deployment repository folder'));
                try {
                    clean(repoPath);
                    cb(null, version);
                } catch (err) {
                    cb(err);
                }
            },
            function copyDistributionFiles(version, cb) {
                gutil.log(gutil.colors.yellow('Copying distribution files to deployment folder'));
                try {
                    files.forEach(function (file) {
                        var stats = fs.lstatSync(file.source);
                        if (stats.isDirectory()) {
                            return;
                        }
                        mkdirp.sync(path.dirname(file.destination));
                        fs.writeFileSync(file.destination, fs.readFileSync(file.source));
                    });
                    cb(null, version);
                } catch (err) {
                    cb(err);
                }
            },
            function updateVersion(version, cb) {
                var bowerFile = path.join(repoPath, 'bower.json'), bowerJson,
                    packageFile = path.join(repoPath, 'package.json'), packageJson,
                    versionJson = { version: version };
                gutil.log(gutil.colors.yellow('Updating version in distribution files (bower.json and package.json)'));

                if (fs.existsSync(bowerFile)) {
                    bowerJson = JSON.parse(fs.readFileSync(bowerFile));
                    bowerJson.version = version;
                    fs.writeFileSync(bowerFile, JSON.stringify(bowerJson, null, '    '));
                }

                if (fs.existsSync(packageFile)) {
                    packageJson = JSON.parse(fs.readFileSync(packageFile));
                    packageJson.version = version;
                    fs.writeFileSync(packageFile, JSON.stringify(packageJson, null, '    '));
                }

                if (!fs.existsSync(bowerFile) && !fs.existsSync(packageFile)) {
                    fs.writeFileSync(path.join(repoPath, 'version.json'), JSON.stringify(versionJson, null, '    '));
                }

                fs.writeFileSync('.version.json', JSON.stringify(versionJson, null, '    '));

                cb(null, version);
            },
            function addDistributionFiles(version, cb) {
                gutil.log(gutil.colors.yellow('Adding files to distribution repository'));
                
                var params = ['add', '--all', '.']; 
                var path = { cwd: repoPath };
                gitCmd(cb, version, params, path);
            },
            function commitDistributionFiles(version, cb) {
                var message = (options.release ? 'Release ' : 'Pre-release ') + version
                gutil.log(gutil.colors.yellow('Committing files to distribution repository'));
                
                var params = ['commit', '-m', message]; 
                var path = { cwd: repoPath };
                gitCmd(cb, version, params, path);
            },
            function tagDistributionFiles(version, cb) {
                var message = options.release ? 'Release' : 'Pre-release'
                gutil.log(gutil.colors.yellow('Tagging files to distribution repository'));
                
                var params = ['tag', '-f', 'v' + version, '-m', message]; 
                var path = { cwd: repoPath };
                gitCmd(cb, version, params, path);
            },
            function pushDistributionFiles(version, cb) {
                gutil.log(gutil.colors.yellow('Pushing files to distribution repository'));

                var params = ['push', '--tags', 'origin', 'master']; 
                var path = { cwd: repoPath };
                gitCmd(cb, version, params, path);
            },
            function removeDistributionRepository(version, cb) {
                gutil.log(gutil.colors.yellow('Removing local distribution repository clone'));
                rimraf(repoPath, function (err) {
                    if (err) {
                        cb(err);
                    } else {
                        cb(null, version);
                    }
                });
            },
            function tagRelease(version, cb) {
                if (options.release) {
                    gutil.log(gutil.colors.yellow('Tagging source files'));
                    
                    var params = ['tag', '-f', 'v' + version, '-m', 'Release']; 
                    gitCmd(cb, version, params);
                } else {
                    gutil.log(gutil.colors.yellow('Not tagging source files - not a release'));
                    cb(null, version);
                }
            },
            function bumpVersions(version, cb) {
                var bowerFile = 'bower.json', bowerJson,
                    packageFile = 'package.json', packageJson,
                    nextRelease;
                if (options.bumpVersion) {
                    nextRelease = semver.inc(version, 'patch');
                    gutil.log(gutil.colors.yellow('Bumbing version to "' + nextRelease + '"'));
                    if (fs.existsSync(bowerFile)) {
                        bowerJson = JSON.parse(fs.readFileSync(bowerFile));
                        bowerJson.version = nextRelease;
                        fs.writeFileSync(bowerFile, JSON.stringify(bowerJson, null, '    '));
                    }
                    if (fs.existsSync(packageFile)) {
                        packageJson = JSON.parse(fs.readFileSync(packageFile));
                        packageJson.version = nextRelease;
                        fs.writeFileSync(packageFile, JSON.stringify(packageJson, null, '    '));
                    }
                }
                cb(null, version);
            },
            function addFiles(version, cb) {
                var versionFiles = [], cmdAdd;
                if (options.bumpVersion) {
                    gutil.log(gutil.colors.yellow('Adding versioned files to repository'));
                    if (fs.existsSync('bower.json')) {
                        versionFiles.push('bower.json');
                    }
                    if (fs.existsSync('package.json')) {
                        versionFiles.push('package.json');
                    }

                    var params = ['add'].concat(versionFiles); 
                    gitCmd(cb, version, params);
                } else {
                    cb(null, version);
                }
            },
            function commitFiles(version, cb) {
                var cmdCommit;
                if (options.bumpVersion) {
                    gutil.log(gutil.colors.yellow('Committing files to repository'));
                    
                    var params = ['commit', '-m', '[gulp] Bumping version']; 
                    gitCmd(cb, version, params);
                } else {
                    cb(null, version);
                }
            },
            function pushFiles(version, cb) {
                var cmdPush;
                if (options.bumpVersion) {
                    gutil.log(gutil.colors.yellow('Pushing files to repository'));

                    var params = ['push', '--tags', '--force', 'origin', 'master']; 
                    gitCmd(cb, version, params);
                } else {
                    cb(null, version);
                }
            }          
        ], function (err) {
            if (err) {
                switch (err) {
                case 'no.version':
                    gutil.log(gutil.colors.magenta('Could not find bower.json or package.json file to read version'));
                    break;
                case 'no.changes':
                    gutil.log(gutil.colors.magenta('No changes to the previous version'));
                    break;
                default:
                    self.emit('error', new gutil.PluginError('gulp-deploy-git', err));
                }
            }
            callback(null);
        });
    });
};
