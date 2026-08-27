import { pythonPurl } from './inventory.mjs';

function scopeProperties(inventory, artifact) {
  return [
    { name: 'com.company.python.scope', value: inventory.scope },
    { name: 'com.company.python.inventory_id', value: inventory.inventory_id },
    { name: 'com.company.python.wheel.filename', value: artifact.filename },
    { name: 'com.company.python.python_version', value: artifact.python_version },
    { name: 'com.company.python.python_tag', value: artifact.python_tag },
    { name: 'com.company.python.abi_tag', value: artifact.abi_tag },
    { name: 'com.company.python.platform_tag', value: artifact.platform_tag },
    { name: 'com.company.python.source', value: artifact.source },
    { name: 'com.company.python.source_index', value: artifact.source_index },
    { name: 'com.company.python.provenance.supplier', value: artifact.provenance.supplier },
    { name: 'com.company.python.provenance.status', value: artifact.provenance.review_status },
  ];
}

export function buildPythonSbomRecords(loaded, packagedInventories = []) {
  const components = [];
  const dependencyMap = new Map();
  for (const { document: inventory } of loaded) {
    const refs = new Map(
      inventory.packages.map((artifact) => [
        artifact.purl,
        `urn:python-wheel:sha256:${artifact.sha256}`,
      ]),
    );
    for (const artifact of inventory.packages) {
      const artifactRef = refs.get(artifact.purl);
      components.push({
        type: 'library',
        'bom-ref': artifactRef,
        name: artifact.package_name,
        version: artifact.version,
        purl: artifact.purl,
        scope: inventory.scope === 'PRODUCTION_WORKER_RUNTIME' ? 'required' : 'optional',
        hashes: [{ alg: 'SHA-256', content: artifact.sha256 }],
        licenses: [{ expression: artifact.license_expression }],
        externalReferences: [
          { type: 'distribution', url: artifact.provenance.download_url },
          { type: 'website', url: artifact.source },
        ],
        properties: scopeProperties(inventory, artifact),
      });
      const dependencies = new Set(
        artifact.dependencies.map((dependency) => refs.get(dependency)).filter(Boolean),
      );
      for (const native of artifact.native_artifacts) {
        components.push({
          type: 'file',
          'bom-ref': `urn:sha256:${native.sha256}`,
          name: native.filename,
          hashes: [{ alg: 'SHA-256', content: native.sha256 }],
          properties: [
            { name: 'com.company.native.type', value: native.type },
            { name: 'com.company.native.relative_path', value: native.relative_path },
            {
              name: 'com.company.native.packaged_relative_path',
              value: native.packaged_relative_path,
            },
            { name: 'com.company.native.source_package', value: artifact.package_name },
            { name: 'com.company.native.source_purl', value: artifact.purl },
            { name: 'com.company.native.source_wheel_sha256', value: artifact.sha256 },
            { name: 'com.company.python.scope', value: inventory.scope },
          ],
        });
        dependencies.add(`urn:sha256:${native.sha256}`);
      }
      dependencyMap.set(artifactRef, dependencies);
    }
  }
  for (const packaged of packagedInventories) {
    for (const native of packaged.native_artifacts) {
      if (components.some((component) => component['bom-ref'] === `urn:sha256:${native.sha256}`)) {
        continue;
      }
      components.push({
        type: 'file',
        'bom-ref': `urn:sha256:${native.sha256}`,
        name: native.filename,
        hashes: [{ alg: 'SHA-256', content: native.sha256 }],
        properties: [
          { name: 'com.company.native.packaged_relative_path', value: native.relative_path },
          { name: 'com.company.native.source_package', value: native.source_package },
          { name: 'com.company.native.source_wheel_sha256', value: native.source_artifact_sha256 },
          { name: 'com.company.native.owner_resolution', value: native.owner_resolution },
        ],
      });
    }
  }
  const dependencies = [...dependencyMap.entries()].map(([ref, dependsOn]) => ({
    ref,
    dependsOn: [...dependsOn].sort(),
  }));
  return { components, dependencies };
}

export function validatePythonSbomBinding(loaded, components) {
  const failures = [];
  for (const { document } of loaded) {
    for (const artifact of document.packages) {
      const component = components.find(
        (entry) =>
          entry.purl === pythonPurl(artifact.package_name, artifact.version) &&
          entry.hashes?.some((hash) => hash.content === artifact.sha256),
      );
      if (!component) failures.push(`${artifact.purl}: missing from SBOM`);
      else if (!component.hashes?.some((hash) => hash.content === artifact.sha256)) {
        failures.push(`${artifact.purl}: SBOM is not bound to wheel SHA-256`);
      }
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
}
