import { readdir, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REQUIRED_CONFIG_FIELDS = ['name', 'enabled', 'components', 'triggers'];

// Module IDs become custom element tag prefixes (<id>-page), so they must be
// lowercase kebab-case starting with a letter and containing a hyphen.
const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;

// Discover all modules by scanning modules/<id>/module.json.
// Returns an array of { id, dir, config } for each valid module.
export async function discoverModules(modulesDir) {
  let entries;
  try {
    entries = await readdir(modulesDir, { withFileTypes: true });
  } catch {
    console.warn(`[module-loader] Modules directory not found: ${modulesDir}`);
    return [];
  }

  const modules = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const moduleId = entry.name;
    const moduleDir = join(modulesDir, moduleId);
    const configPath = join(moduleDir, 'module.json');

    try {
      const raw = await readFile(configPath, 'utf-8');
      const config = JSON.parse(raw);
      const errors = validateConfig(moduleId, config);

      if (errors.length > 0) {
        console.error(`[module-loader] Invalid config for "${moduleId}":`);
        errors.forEach(e => console.error(`  - ${e}`));
        continue;
      }

      // Warn if ui.page is true but the expected page file doesn't exist
      if (config.ui?.page) {
        const pagePath = join(moduleDir, 'ui', `${moduleId}-page.js`);
        try {
          await access(pagePath);
        } catch {
          console.warn(`[module-loader] ${moduleId}: ui.page is true but "${moduleId}-page.js" not found in ui/`);
        }
      }

      modules.push({ id: moduleId, dir: moduleDir, config });
      console.log(`[module-loader] Discovered module: ${moduleId} (${config.name})`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // No module.json — skip silently (might be a utility directory)
      } else {
        console.error(`[module-loader] Error reading config for "${moduleId}":`, err.message);
      }
    }
  }

  return modules;
}

/**
 * Validate a module.json config.
 * @param {string} moduleId
 * @param {Object} config
 * @returns {string[]} Array of error messages (empty = valid)
 */
export function validateConfig(moduleId, config) {
  const errors = [];

  if (!MODULE_ID_PATTERN.test(moduleId)) {
    errors.push(`Module ID "${moduleId}" must be lowercase kebab-case with at least one hyphen (e.g. "my-module")`);
  }

  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (config[field] === undefined) {
      errors.push(`Missing required field: "${field}"`);
    }
  }

  if (typeof config.enabled !== 'boolean') {
    errors.push('"enabled" must be a boolean');
  }

  if (config.components) {
    if (!Array.isArray(config.components.read)) {
      errors.push('"components.read" must be an array');
    }
    if (config.components.write !== undefined && !Array.isArray(config.components.write)) {
      errors.push('"components.write" must be an array');
    }
  }

  if (config.triggers) {
    const hasInterval = config.triggers.interval != null;
    const hasOnChange = Array.isArray(config.triggers.onChange) && config.triggers.onChange.length > 0;

    if (hasInterval && (typeof config.triggers.interval !== 'number' || config.triggers.interval < 100)) {
      errors.push('"triggers.interval" must be a number >= 100 (ms)');
    }

    if (config.triggers.onChange !== undefined && !Array.isArray(config.triggers.onChange)) {
      errors.push('"triggers.onChange" must be an array of component IDs');
    }
  }

  if (config.ui?.page && !config.ui.label) {
    errors.push('"ui.label" is required when "ui.page" is true');
  }

  if (config.ui?.standalone && !config.ui.label) {
    errors.push('"ui.label" is required when "ui.standalone" is true');
  }

  return errors;
}

/**
 * Validate that a module's component references exist in the sensor-service component list.
 * @param {Object} config - Parsed module.json
 * @param {Array} components - Component list from sensor-service
 * @returns {string[]} Array of warning messages
 */
export function validateComponentRefs(config, components) {
  const warnings = [];
  const validIds = new Set(components.map(c => c.id));

  for (const id of config.components.read || []) {
    if (!validIds.has(id)) {
      warnings.push(`Read component "${id}" not found in sensor-service`);
    }
  }

  for (const id of config.components.write || []) {
    if (!validIds.has(id)) {
      warnings.push(`Write component "${id}" not found in sensor-service`);
    }
  }

  for (const id of config.triggers.onChange || []) {
    if (!validIds.has(id)) {
      warnings.push(`onChange trigger component "${id}" not found in sensor-service`);
    }
  }

  return warnings;
}

/**
 * Dynamically import a module's logic class.
 * @param {string} moduleId
 * @param {string} moduleDir - Absolute path to module directory
 * @returns {Promise<typeof import('./base-module.js').BaseModule>} The module's default export class
 */
export async function loadModuleClass(moduleId, moduleDir) {
  const logicPath = join(moduleDir, `${moduleId}.module.js`);
  const fileUrl = pathToFileURL(logicPath).href;
  const mod = await import(fileUrl);

  if (!mod.default) {
    throw new Error(`Module "${moduleId}" must have a default export`);
  }

  return mod.default;
}
