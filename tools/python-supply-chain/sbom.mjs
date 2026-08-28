import { pythonPurl } from './inventory.mjs';

function scopeProperties(inventory, artifact) {
  const properties = [
    { name: 'com.company.python.scope', value: inventory.scope },
    { name: 'com.company.python.inventory_id', value: inventory.inventory_id },
    { name: 'com.company.python.wheel.filename', value: artifact.filename },
    { name: 'com.company.python.source', value: artifact.source },
    { name: 'com.company.python.source_index', value: artifact.source_index },
    { name: 'com.company.python.provenance.supplier', value: artifact.provenance.supplier },
    { name: 'com.company.python.provenance.status', value: artifact.provenance.review_status },
  ];
  if (inventory.schema_version === '1') {
    properties.push(
      { name: 'com.company.python.python_version', value: artifact.python_version },
      { name: 'com.company.python.python_tag', value: artifact.python_tag },
      { name: 'com.company.python.abi_tag', value: artifact.abi_tag },
      { name: 'com.company.python.platform_tag', value: artifact.platform_tag },
    );
  } else {
    properties.push(
      { name: 'com.company.python.python_version', value: inventory.target.python_version },
      { name: 'com.company.python.target_os', value: inventory.target.os },
      { name: 'com.company.python.target_architecture', value: inventory.target.architecture },
      { name: 'com.company.python.wheel_tags', value: JSON.stringify(artifact.wheel_tags) },
      {
        name: 'com.company.python.compatibility_engine',
        value: inventory.target.compatibility.compatibility_engine,
      },
      {
        name: 'com.company.python.compatibility_engine_version',
        value: inventory.target.compatibility.compatibility_engine_version,
      },
      {
        name: 'com.company.python.packaging_version',
        value: inventory.target.compatibility.packaging_version,
      },
      {
        name: 'com.company.python.compatibility_matched_tags',
        value: JSON.stringify(artifact.compatibility.matched_tags),
      },
    );
  }
  return properties;
}

function licensePolicyProperties(expression, decision) {
  const properties = [{ name: 'com.company.license.declared_expression', value: expression }];
  if (!decision) return properties;
  properties.push(
    { name: 'com.company.license.policy_result', value: decision.policy_result },
    { name: 'com.company.license.policy_version', value: decision.license_policy_version },
    {
      name: 'com.company.license.acceptable_or_branches',
      value: JSON.stringify(decision.acceptable_or_branches),
    },
  );
  if (decision.selected_policy_branch) {
    properties.push({
      name: 'com.company.license.selected_policy_branch',
      value: decision.selected_policy_branch,
    });
  }
  return properties;
}

export function buildPythonSbomRecords(loaded, packagedInventories = [], licenseDecisions = []) {
  const components = [];
  const dependencyMap = new Map();
  const decisionsByHash = new Map(
    licenseDecisions.map((decision) => [decision.artifact_sha256, decision]),
  );
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
        properties: [
          ...scopeProperties(inventory, artifact),
          ...licensePolicyProperties(
            artifact.license_expression,
            decisionsByHash.get(artifact.sha256),
          ),
        ],
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
            { name: 'com.company.native.owner_kind', value: 'WHEEL_OWNED_NATIVE' },
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
        properties:
          packaged.schema_version === '1'
            ? [
                { name: 'com.company.native.packaged_relative_path', value: native.relative_path },
                { name: 'com.company.native.source_package', value: native.source_package },
                {
                  name: 'com.company.native.source_wheel_sha256',
                  value: native.source_artifact_sha256,
                },
                { name: 'com.company.native.owner_resolution', value: native.owner_resolution },
              ]
            : [
                { name: 'com.company.native.internal_path', value: native.internal_path },
                { name: 'com.company.native.owner_kind', value: native.owner_kind },
                { name: 'com.company.native.owner_reference', value: native.owner_reference },
                {
                  name: 'com.company.native.source_artifact_sha256',
                  value: native.source_artifact_sha256,
                },
                { name: 'com.company.native.owner_resolution', value: native.owner_resolution },
                { name: 'com.company.native.build_layer', value: native.build_layer },
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

export function buildToolchainSbomRecords(toolchains = [], builds = [], licenseDecisions = []) {
  const components = [];
  const dependencies = [];
  const decisionsByHash = new Map(
    licenseDecisions.map((decision) => [decision.artifact_sha256, decision]),
  );
  for (const toolchain of toolchains) {
    const byId = new Map(
      toolchain.components.map((component) => [
        component.component_id,
        `urn:toolchain-artifact:sha256:${component.artifact.sha256}`,
      ]),
    );
    for (const component of toolchain.components) {
      const ref = byId.get(component.component_id);
      components.push({
        type: 'framework',
        'bom-ref': ref,
        name: component.name,
        version: component.version,
        hashes: [{ alg: 'SHA-256', content: component.artifact.sha256 }],
        licenses: [{ expression: component.license.expression }],
        externalReferences: [
          { type: 'distribution', url: component.artifact.canonical_reference },
          { type: 'website', url: component.artifact.canonical_source },
        ],
        properties: [
          { name: 'com.company.native.owner_kind', value: 'TOOLCHAIN_OWNED_NATIVE' },
          { name: 'com.company.toolchain.inventory_id', value: toolchain.inventory_id },
          { name: 'com.company.toolchain.component_id', value: component.component_id },
          { name: 'com.company.toolchain.component_kind', value: component.component_kind },
          {
            name: 'com.company.toolchain.usage_scopes',
            value: JSON.stringify(component.usage_scopes),
          },
          { name: 'com.company.toolchain.artifact.filename', value: component.artifact.filename },
          ...licensePolicyProperties(
            component.license.expression,
            decisionsByHash.get(component.artifact.sha256),
          ),
        ],
      });
      for (const native of component.packaged_native_artifacts) {
        const nativeRef = `urn:toolchain-native:sha256:${native.sha256}:${native.internal_path}`;
        components.push({
          type: 'file',
          'bom-ref': nativeRef,
          name: native.filename,
          hashes: [{ alg: 'SHA-256', content: native.sha256 }],
          properties: [
            { name: 'com.company.native.owner_kind', value: 'TOOLCHAIN_OWNED_NATIVE' },
            { name: 'com.company.native.owner_reference', value: component.component_id },
            { name: 'com.company.native.internal_path', value: native.internal_path },
            { name: 'com.company.native.source_artifact_sha256', value: component.artifact.sha256 },
            { name: 'com.company.native.build_layer', value: native.build_layer },
          ],
        });
      }
      dependencies.push({
        ref,
        dependsOn: [
          ...component.dependencies.map((dependency) => byId.get(dependency)).filter(Boolean),
          ...component.packaged_native_artifacts.map(
            (native) => `urn:toolchain-native:sha256:${native.sha256}:${native.internal_path}`,
          ),
        ].sort(),
      });
    }
  }
  for (const build of builds) {
    const ref = `urn:build-artifact:sha256:${build.final_artifact.sha256}`;
    components.push({
      type: 'application',
      'bom-ref': ref,
      name: build.final_artifact.filename,
      hashes: [{ alg: 'SHA-256', content: build.final_artifact.sha256 }],
      properties: [
        { name: 'com.company.artifact.owner_kind', value: 'BUILD_ARTIFACT' },
        { name: 'com.company.build.id', value: build.build_id },
        { name: 'com.company.build.commit', value: build.build_commit_sha },
        { name: 'com.company.build.run_identity', value: build.run_identity },
        { name: 'com.company.build.config.sha256', value: build.build_configuration.sha256 },
        { name: 'com.company.build.bit_for_bit_required', value: 'false' },
        {
          name: 'com.company.build.bootloader_sha256',
          value: build.output_layers.bootloader_sha256,
        },
        {
          name: 'com.company.build.archive_payload_sha256',
          value: build.output_layers.archive_payload_sha256,
        },
        ...licensePolicyProperties(
          decisionsByHash.get(build.final_artifact.sha256)?.detected_license_expression ??
            'INHERITED_TOOLCHAIN_LICENSE_RELATIONSHIP',
          decisionsByHash.get(build.final_artifact.sha256),
        ),
      ],
    });
    dependencies.push({
      ref,
      dependsOn: [
        ...build.inputs.wheel_inventories.map(
          (inventory) => `urn:wheel-inventory:sha256:${inventory.manifest_sha256}`,
        ),
        `urn:toolchain-inventory:sha256:${build.inputs.toolchain_inventory.manifest_sha256}`,
      ].sort(),
    });
  }
  return { components, dependencies };
}
