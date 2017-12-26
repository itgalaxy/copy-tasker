#!/usr/bin/env node
"use strict";

const meow = require("meow");
const ora = require("ora");
const globby = require("globby");
const cosmiconfig = require("cosmiconfig");
const path = require("path");
const fs = require("fs-extra");
const findCacheDir = require("find-cache-dir");
const os = require("os");
const pLimit = require("p-limit");
const cacache = require("cacache");
const serialize = require("serialize-javascript");

const cli = meow(
  `Usage copy-tasker [input]

    Input: Name of task.

    Options:

     --verbose

        Output detailed information.

    Examples:

      $ copy-tasker images
`,
  {
    flags: {
      verbose: {
        default: false,
        type: "boolean"
      }
    }
  }
);

function run(taskNames, options) {
  const explorer = cosmiconfig("copy-tasker");

  if (taskNames.length === 0) {
    throw new Error("No task(s) specified");
  }

  const { verbose } = options;

  let spinner = null;

  if (verbose) {
    spinner = ora()
      .start()
      .info("Search configuration...");
  }

  return Promise.resolve()
    .then(() => explorer.load(process.cwd()))
    .then(result => {
      if (!result) {
        throw new Error("No task specified");
      }

      if (verbose) {
        spinner.info(`Found configuration by path '${result.filepath}'`);
      }

      const { config } = result;
      const tasks = [];

      taskNames.forEach(taskName => {
        if (!config[taskName]) {
          throw new Error(`Cannot find '${taskName}' in configuration`);
        }

        const taskOptions = config[taskName];
        const { from, to, globOptions, cache, concurrent } = taskOptions;

        if (!from) {
          throw new Error("Each task should have 'from' property");
        }

        if (!to) {
          throw new Error("Each task should have 'to' property");
        }

        const cacheDir =
          cache === true ? findCacheDir({ name: "copy-tasker" }) : cache;
        const maxConcurrent = Number.isInteger(concurrent)
          ? Math.min(Number(concurrent) || 0, os.cpus().length - 1)
          : os.cpus().length - 1;

        const limit = pLimit(maxConcurrent);

        tasks.push(
          Promise.resolve()
            .then(() => {
              if (verbose) {
                spinner.info(`Start '${taskName}' task`);
              }

              return Promise.resolve();
            })
            .then(() => {
              if (taskOptions.before) {
                if (verbose) {
                  spinner.info("Run 'before' hook");
                }

                return taskOptions.before(options, taskOptions);
              }

              return Promise.resolve();
            })
            .then(() => {
              if (verbose) {
                spinner.start("Collect files");
              }

              return Promise.resolve();
            })
            .then(
              () =>
                globby(from, globOptions)
                  .then(filePaths => {
                    if (verbose) {
                      spinner.succeed("Files collected");
                    }

                    return filePaths;
                  })
                  /* eslint-disable max-nested-callbacks */
                  .then(filePaths =>
                    Promise.all(
                      filePaths.map(filePath =>
                        limit(() =>
                          Promise.resolve()
                            .then(() => {
                              const cwd = globOptions.cwd
                                ? globOptions.cwd
                                : process.cwd();
                              const srcFilePath = path.join(cwd, filePath);
                              const destFilePath = path.join(to, filePath);

                              return Promise.resolve()
                                .then(() => {
                                  if (verbose) {
                                    spinner.info(
                                      `Copy file from '${srcFilePath}' to '${destFilePath}'...`
                                    );
                                  }

                                  return Promise.resolve();
                                })
                                .then(() => {
                                  if (
                                    taskOptions.transform &&
                                    taskOptions.transformTest.test(srcFilePath)
                                  ) {
                                    return Promise.resolve()
                                      .then(() => fs.readFile(srcFilePath))
                                      .then(data => {
                                        // Add pkg version
                                        const cacheKey = JSON.stringify({
                                          data,
                                          taskOptions: serialize(taskOptions)
                                        });

                                        return cacache
                                          .get(cacheDir, cacheKey)
                                          .then(
                                            metadata => {
                                              if (verbose) {
                                                spinner.info(
                                                  `Found cache for file from '${srcFilePath}' to '${destFilePath}'...`
                                                );
                                              }

                                              return metadata.data;
                                            },
                                            () => {
                                              if (verbose) {
                                                spinner.info(
                                                  `Use 'transform' for file from '${srcFilePath}' to '${destFilePath}'...`
                                                );
                                              }

                                              return taskOptions
                                                .transform(
                                                  data,
                                                  srcFilePath,
                                                  destFilePath,
                                                  options,
                                                  taskOptions
                                                )
                                                .then(transformedData => {
                                                  if (verbose) {
                                                    spinner.info(
                                                      `Put cache for file from '${srcFilePath}' to '${destFilePath}'...`
                                                    );
                                                  }

                                                  return cacache
                                                    .put(
                                                      cacheDir,
                                                      cacheKey,
                                                      transformedData
                                                    )
                                                    .then(
                                                      () => transformedData
                                                    );
                                                });
                                            }
                                          );
                                      })
                                      .then(data =>
                                        fs.outputFile(destFilePath, data)
                                      );
                                  }

                                  return fs.copy(srcFilePath, destFilePath);
                                })
                                .then(() => {
                                  if (verbose) {
                                    spinner.succeed(
                                      `File from '${srcFilePath}' to '${destFilePath}' was copied`
                                    );
                                  }

                                  return Promise.resolve();
                                })
                                .catch(error => {
                                  if (verbose) {
                                    spinner.fail(
                                      `Failed copy file from '${srcFilePath}' to '${destFilePath}'. ${error}`
                                    );
                                  }

                                  throw error;
                                });
                            })
                            .catch(error => {
                              spinner.fail(error);
                            })
                        )
                      )
                    )
                  )
              /* eslint-enable max-nested-callbacks */
            )
            .then(() => {
              if (taskOptions.after) {
                if (verbose) {
                  spinner.info("Run 'after' hook");
                }

                return taskOptions.after(options, taskOptions);
              }

              return Promise.resolve();
            })
            .then(() => {
              if (verbose) {
                spinner.succeed(`Task '${taskName}' was completed`);
              }

              return Promise.resolve();
            })
        );
      });

      return Promise.all(tasks);
    })
    .catch(error => {
      if (verbose) {
        spinner.stop();
      }

      throw error;
    });
}

run(cli.input, cli.flags).catch(error => {
  console.log(error.stack || error); // eslint-disable-line no-console

  const exitCode = typeof error.code === "number" ? error.code : 1;

  process.exit(exitCode); // eslint-disable-line no-process-exit
});
