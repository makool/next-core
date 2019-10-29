import { get } from "lodash";
import {
  Storyboard,
  RouteConf,
  RuntimeBrickConf,
  BrickTemplateFactory,
  TemplateRegistry,
  TemplatePackage
} from "@easyops/brick-types";
import { loadScript } from "./loadScript";
import { getDepsOfTemplates } from "./getTemplateDepsOfStoryboard";

export async function asyncProcessBrick(
  brickConf: RuntimeBrickConf,
  templateRegistry: TemplateRegistry<BrickTemplateFactory>,
  templatePackages: TemplatePackage[]
): Promise<void> {
  if (brickConf.template) {
    if (
      !brickConf.$$resolved &&
      get(brickConf, ["lifeCycle", "useResolves"], []).length > 0
    ) {
      // Leave these dynamic templates to `LocationContext::resolve()`.
      // Remember original params, cause it maybe changed when resolving.
      brickConf.$$params = {
        ...brickConf.params
      };
    } else {
      let updatedBrickConf: Partial<RuntimeBrickConf> = {};
      if (!templateRegistry.has(brickConf.template)) {
        await loadScript(
          getDepsOfTemplates([brickConf.template], templatePackages)
        );
      }
      if (templateRegistry.has(brickConf.template)) {
        updatedBrickConf = templateRegistry.get(brickConf.template)(
          brickConf.params
        );
      } else {
        updatedBrickConf = {
          brick: "basic-bricks.page-error",
          properties: {
            error: `Template not found: ${brickConf.template}`
          }
        };
      }
      // 清理 brickConf.
      const { template, lifeCycle, $$params, params } = brickConf;
      Object.keys(brickConf).forEach(key => {
        delete brickConf[key as keyof RuntimeBrickConf];
      });
      Object.assign(brickConf, updatedBrickConf, {
        $$template: template,
        $$params: $$params || params,
        $$lifeCycle: lifeCycle
      });
    }
  }
  if (brickConf.slots) {
    await Promise.all(
      Object.values(brickConf.slots).map(async slotConf => {
        if (slotConf.type === "bricks") {
          await asyncProcessBricks(
            slotConf.bricks,
            templateRegistry,
            templatePackages
          );
        } else {
          await asyncProcessRoutes(
            slotConf.routes,
            templateRegistry,
            templatePackages
          );
        }
      })
    );
  }
}

async function asyncProcessBricks(
  bricks: RuntimeBrickConf[],
  templateRegistry: TemplateRegistry<BrickTemplateFactory>,
  templatePackages: TemplatePackage[]
): Promise<void> {
  if (Array.isArray(bricks)) {
    await Promise.all(
      bricks.map(async brickConf => {
        await asyncProcessBrick(brickConf, templateRegistry, templatePackages);
      })
    );
  }
}

async function asyncProcessRoutes(
  routes: RouteConf[],
  templateRegistry: TemplateRegistry<BrickTemplateFactory>,
  templatePackages: TemplatePackage[]
): Promise<void> {
  if (Array.isArray(routes)) {
    await Promise.all(
      routes.map(async routeConf => {
        await asyncProcessBricks(
          routeConf.bricks,
          templateRegistry,
          templatePackages
        );
        const menuBrickConf = routeConf.menu;
        if (menuBrickConf && menuBrickConf.type === "brick") {
          await asyncProcessBrick(
            menuBrickConf,
            templateRegistry,
            templatePackages
          );
        }
      })
    );
  }
}

export async function asyncProcessStoryboard(
  storyboard: Storyboard,
  templateRegistry: TemplateRegistry<BrickTemplateFactory>,
  templatePackages: TemplatePackage[]
): Promise<Storyboard> {
  await asyncProcessRoutes(
    storyboard.routes,
    templateRegistry,
    templatePackages
  );
  return storyboard;
}