// File System, hard to test for now.
/* istanbul ignore file */
import path from "path";
import os from "os";
import fs from "fs-extra";
import chalk from "chalk";
import prettier from "prettier";
import * as changeCase from "change-case";
import { getEasyopsConfig } from "@next-core/repo-config";
import { ask } from "./ask";
import { loadTemplate } from "./loaders/loadTemplate";
import { TargetType, AskFlags } from "./interface";
import { targetMap } from "./constant";
import { scriptYarnInstall } from "./scripts";

const { usePublicScope } = getEasyopsConfig();

const npmScopeOfSdk = usePublicScope ? "@next-sdk" : "@sdk";

export async function create(flags: AskFlags): Promise<void> {
  const appRoot = path.join(process.cwd());
  let targetType: TargetType;
  let packageName = "";
  let brickName = "";
  let templateName = "";
  let processorName = "";
  if (flags.provider) {
    targetType = TargetType["A_NEW_PACKAGE_OF_PROVIDERS"];
    packageName = `providers-of-${flags.provider}`;
  } else {
    ({
      targetType,
      packageName,
      brickName,
      templateName,
      processorName,
    } = await ask(appRoot, flags));
  }

  const pkgRoot = path.join(appRoot, targetMap[targetType], packageName);

  let targetRoot: string;
  switch (targetType) {
    case TargetType.A_NEW_BRICK:
      targetRoot = path.join(pkgRoot, "src", brickName);
      break;
    case TargetType.A_NEW_EDITOR_BRICK:
      targetRoot = path.join(pkgRoot, "src/editor-bricks", brickName);
      break;
    case TargetType.A_NEW_CUSTOM_TEMPLATE:
      targetRoot = path.join(pkgRoot, "src/custom-templates");
      break;
    case TargetType.A_NEW_CUSTOM_PROVIDER_BRICK:
      targetRoot = path.join(pkgRoot, "src/data-providers");
      break;
    case TargetType.A_NEW_CUSTOM_PROCESSOR:
      targetRoot = path.join(pkgRoot, "src/custom-processors");
      break;
    case TargetType.A_NEW_LEGACY_TEMPLATE:
      targetRoot = path.join(pkgRoot, "src");
      break;
    default:
      targetRoot = path.join(pkgRoot);
  }

  let files = await loadTemplate({
    targetType,
    packageName,
    brickName,
    templateName,
    processorName,
    targetRoot,
  });

  switch (targetType) {
    case TargetType.A_NEW_PACKAGE_OF_PROVIDERS:
      {
        // 不覆盖生成，后续如果需要可以询问时加多一步是否覆盖
        const packageJson = path.join(targetRoot, "package.json");
        if (fs.existsSync(packageJson)) {
          console.log(chalk.yellow(`${packageName} exist provider`));
          files = [];
        }
        // 如果 `providers.json` 不存在时才新建，已存在时不覆盖。
        const providersJsonPath = path.join(targetRoot, "providers.json");
        if (!fs.existsSync(providersJsonPath)) {
          files.push([
            providersJsonPath,
            JSON.stringify(
              {
                sdk: `${npmScopeOfSdk}/${packageName.replace(
                  /^providers-of-/,
                  ""
                )}-sdk`,
                providers: [],
              },
              null,
              2
            ),
          ]);
        }
      }
      break;
    case TargetType.TRANSFORM_A_MICRO_APP:
      {
        const microAppPackageJsonPath = path.join(targetRoot, "package.json");
        const microAppPackageJson = require(microAppPackageJsonPath);
        Object.assign(microAppPackageJson.scripts, {
          start:
            'concurrently -k -n tsc,build "tsc -w --preserveWatchOutput" "node scripts/build.js -w"',
          prestart: "rimraf dist",
          prebuild: "rimraf dist && tsc",
          build: "node scripts/build.js",
        });

        files.push([
          microAppPackageJsonPath,
          JSON.stringify(microAppPackageJson, null, 2),
        ]);

        const storyboardJsonPath = path.join(targetRoot, "storyboard.json");
        const storyboardJson = require(storyboardJsonPath);
        delete storyboardJson.$schema;
        const srcIndexTs = path.join(pkgRoot, "src", "index.ts");
        files.push([
          srcIndexTs,
          prettier.format(
            `import { Storyboard } from "@next-core/brick-types";

const storyboard: Storyboard = ${JSON.stringify(storyboardJson)};

export default storyboard;`,
            { parser: "typescript" }
          ),
        ]);
      }
      break;
  }

  for (const [filePath, content] of files) {
    fs.outputFileSync(filePath, content);
    console.log(
      `${chalk.bold("File created")}: ./${path.relative(
        process.cwd(),
        filePath
      )}`
    );
  }

  switch (targetType) {
    case TargetType.A_NEW_BRICK:
    case TargetType.A_NEW_CUSTOM_TEMPLATE:
    case TargetType.A_NEW_CUSTOM_PROVIDER_BRICK:
    case TargetType.A_NEW_CUSTOM_PROCESSOR:
    case TargetType.A_NEW_PACKAGE_OF_BRICKS:
      if (brickName || processorName) {
        // 如果是新建构件/自定义provider构件/构件库，需要更新/新建 `index.ts`。
        const srcIndexTs = path.join(pkgRoot, "src/index.ts");
        switch (targetType) {
          case TargetType.A_NEW_CUSTOM_PROVIDER_BRICK:
            fs.appendFileSync(
              srcIndexTs,
              `import "./data-providers/${changeCase.pascalCase(brickName)}";${
                os.EOL
              }`
            );
            break;
          case TargetType.A_NEW_CUSTOM_TEMPLATE:
            fs.appendFileSync(
              srcIndexTs,
              `import "./custom-templates/${brickName}";${os.EOL}`
            );
            break;
          case TargetType.A_NEW_CUSTOM_PROCESSOR:
            fs.appendFileSync(
              srcIndexTs,
              `import "./custom-processors/${processorName}";${os.EOL}`
            );
            break;
          default:
            fs.appendFileSync(srcIndexTs, `import "./${brickName}";${os.EOL}`);
        }

        if (
          targetType === TargetType.A_NEW_BRICK ||
          targetType === TargetType.A_NEW_CUSTOM_TEMPLATE ||
          targetType === TargetType.A_NEW_CUSTOM_PROVIDER_BRICK ||
          targetType === TargetType.A_NEW_CUSTOM_PROCESSOR
        ) {
          console.log(
            `${chalk.bold("File updated")}: ./${path.relative(
              process.cwd(),
              srcIndexTs
            )}`
          );
        }

        if (
          targetType === TargetType.A_NEW_CUSTOM_TEMPLATE ||
          targetType === TargetType.A_NEW_CUSTOM_PROCESSOR
        ) {
          // 如果新增了自定义模板或自定义加工函数，`src/index.spec.ts` 需要更新。
          const indexSpecTs = path.join(pkgRoot, "src/index.spec.ts");
          if (fs.existsSync(indexSpecTs)) {
            const currentContent = fs.readFileSync(indexSpecTs, "utf8");
            if (!currentContent.includes("registerCustomProcessor")) {
              const templateContent = fs.readFileSync(
                path.join(
                  __dirname,
                  "../template/bricks-pkg/src/index.spec.ts"
                ),
                "utf8"
              );
              fs.writeFileSync(indexSpecTs, templateContent);
              console.log(
                `${chalk.bold("File updated")}: ./${path.relative(
                  process.cwd(),
                  indexSpecTs
                )}`
              );
            }
          }
        }
      }
      break;
    case TargetType.A_NEW_LEGACY_TEMPLATE:
    case TargetType.A_NEW_PACKAGE_OF_LEGACY_TEMPLATES:
      {
        // 如果是新建模板/模板库，需要更新/新建 `index.ts`。
        const srcIndexTs = path.join(pkgRoot, "src", "index.ts");
        fs.appendFileSync(srcIndexTs, `import "./${templateName}";${os.EOL}`);

        if (targetType === TargetType.A_NEW_LEGACY_TEMPLATE) {
          console.log(
            `${chalk.bold("File updated")}: ./${path.relative(
              process.cwd(),
              srcIndexTs
            )}`
          );
        }
      }
      break;
    case TargetType.TRANSFORM_A_MICRO_APP:
      {
        const storyboardJsonPath = path.join(targetRoot, "storyboard.json");
        fs.unlinkSync(storyboardJsonPath);
        console.log(
          `${chalk.bold.yellow("File removed")}: ./${path.relative(
            process.cwd(),
            storyboardJsonPath
          )}`
        );
      }
      break;
    case TargetType.I18N_PATCH_A_PACKAGE_OF_LEGACY_TEMPLATES:
      {
        const srcIndexTs = path.join(pkgRoot, "src", "index.ts");
        fs.writeFileSync(
          srcIndexTs,
          `import "./i18n";${os.EOL}${fs.readFileSync(srcIndexTs)}`
        );
        console.log(
          `${chalk.bold("File updated")}: ./${path.relative(
            process.cwd(),
            srcIndexTs
          )}`
        );
      }
      break;
    case TargetType.A_NEW_EDITOR_BRICK:
      {
        const editorBricksIndexTs = path.join(
          pkgRoot,
          "src/editor-bricks/index.ts"
        );
        const importStatement = `import "./${brickName}/${brickName}.editor";${os.EOL}`;
        const fileExisted = fs.existsSync(editorBricksIndexTs);
        if (fileExisted) {
          fs.appendFileSync(editorBricksIndexTs, importStatement);
        } else {
          fs.writeFileSync(editorBricksIndexTs, importStatement);
        }

        console.log(
          `${chalk.bold(
            `File ${fileExisted ? "updated" : "created"}`
          )}: ./${path.relative(process.cwd(), editorBricksIndexTs)}`
        );
      }
      break;
  }

  if (
    [
      TargetType.A_NEW_PACKAGE_OF_BRICKS,
      TargetType.A_NEW_PACKAGE_OF_LIBS,
      TargetType.A_NEW_PACKAGE_OF_MICRO_APPS,
      TargetType.A_NEW_PACKAGE_OF_PROVIDERS,
      TargetType.A_NEW_PACKAGE_OF_LEGACY_TEMPLATES,
      TargetType.TRANSFORM_A_MICRO_APP,
    ].includes(targetType)
  ) {
    // Run `yarn` after created a new package.
    await scriptYarnInstall(appRoot);
  }

  console.log();
  console.log(chalk.green("No worries!"));
}
