gulp-git-release
================

> Do pre-releases and releases of gulp based projects into Git repository.

The files in the release repository is going to be tagged with either the release version or with the
sha of the current source state if doing a pre-release. That is the flow of a release will be as follows:

- The version is read from `bower.json` or `package.json` with preference for the first.
- The distribution Git repository is cloned.
- The content of the distribution repository is replaced with the files to be distributed.
- The new distribution is committed and tagged. If it is a pre-release the tag will have the format
  "v&lt;x.y.z>-build.&lt;number>+sha.&lt;source sha>", e.g., "v0.3.0-build.25+sha.f52cbe6". If it is a release
  the tag will only contain the version, e.g., "v0.3.0".
  The build number is read from the environment variable `BUILD_NUMBER` or set to `beta` otherwise.
  When doing a release the source repository will be tagged with the release version and the version specified in `bower.json` and `package.json` will be bumped.
- A `version.json` file is created as part of the distribution files containing the same version tag as well as a `.version.json` in the root of the source project. The latter is useful for a continuous integration system, such as Jenkins, to do trigger deployment of the committed distribution files.
- All changes are pushed back to the source and the distribution repositories. Credentials to allow this _must_ be available to Git.

## Usage

### Pre-release

```javascript
var release = require('gulp-git-release');

gulp.task('pre-release', function() {
    return gulp.src('target/dist/**/*')
        .pipe(release({
            prefix: 'target/dist',
            release: false,
            debug: false,
            repository: 'https://github.com/langecode/bower-module.git'
        }));
});
```

The given prefix will be removed before files are copied to the distribution repository.

### Release

```javascript
var release = require('gulp-git-release');

gulp.task('release', function() {
    return gulp.src('target/dist/**/*')
        .pipe(release({
            prefix: 'target/dist',
            release: true,
            debug: false,
            repository: 'https://github.com/langecode/bower-module.git'
        }));
});
```

Setting the release flag to true causes the plugin to tag the source repository and bump the patch version of the
bower.json and package.json files in the source repository.

If you do not want to bump the patch version, you can set the `bumpVersion` flag to `false`:

```javascript
        .pipe(release({
            prefix: 'target/dist',
            release: true,
            debug: false,
            repository: 'https://github.com/langecode/bower-module.git',
            bumpVersion: false
        }));
```

This is useful if your project calls the plugin more than once, e.g. because you are releasing both a Bower component and an application.

If `bumpVersion` is not specified, it will default to `false` for pre-releases and `true` for releases.

If `debug` is not specified, it will default to `false` for both pre-releases and for releases. By settings `debug` to true, 
stdout from git cmd calls will be printed to the console.
