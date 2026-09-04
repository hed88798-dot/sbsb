import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  companionIdentityHash,
  manifestHash,
  verifyCompanionBundle,
} from '../../tools/native-runtime-companion/companion.mjs';

type Platform = { os: 'linux' | 'windows'; architecture: 'x86_64' | 'arm64' };
type MemberKind =
  | 'EXECUTABLE'
  | 'DYNAMIC_LIBRARY'
  | 'INTERNAL_COMPANION_MEMBER'
  | 'DATA'
  | 'SYMLINK';
type Member = { path: string; sha256: string; kind: MemberKind; link_target?: string };
type RuntimeMember = {
  name: string;
  classification: 'INTERNAL_COMPANION_MEMBER' | 'EXTERNAL_OS_PREREQUISITE';
  member_path?: string;
  loader_scope?: 'COMPANION_BUNDLE_ONLY';
};
type Provenance = {
  upstream_project: string;
  upstream_release: string;
  upstream_tag: string;
  upstream_commit: string;
  source_archive_identity: string;
  source_archive_sha256: string;
  build_recipe_id: string;
  build_recipe_sha256: string;
  build_environment_descriptor_id: string;
  build_environment_descriptor_sha256: string;
  build_context_id: string;
  build_context_sha256: string;
  target_platform: 'linux' | 'windows';
  target_architecture: 'x86_64' | 'arm64';
};
type BuildConfiguration = {
  configure_arguments: string[];
  build_arguments: string[];
  compiler_identity: string;
  toolchain_identity: string;
  enabled_components: string[];
  disabled_components: string[];
  external_linked_libraries: string[];
  linkage: 'STATIC' | 'SHARED' | 'MIXED';
  feature_selection?: string[];
};
type CompanionManifest = {
  schema_version: '1';
  subject_type: 'NATIVE_RUNTIME_COMPANION_BUNDLE';
  companion_id: string;
  manifest_sha256: string;
  companion_identity_sha256: string;
  role: 'PRODUCT_RUNTIME_DEPENDENCY';
  platform: Platform;
  entrypoint: { path: string; sha256: string };
  bundle_members: Member[];
  runtime_dependency_closure: {
    status: 'PASS';
    loader_policy: 'COMPANION_BUNDLE_ONLY';
    undeclared_runtime_resolution: 'FAIL_CLOSED';
    unresolved_count: number;
    members: RuntimeMember[];
    external_os_prerequisites: Array<{
      id: string;
      name: string;
      version_policy: string;
      allowlisted: true;
    }>;
  };
  provenance: Provenance;
  build_configuration: BuildConfiguration;
  distribution: {
    mode: 'BUNDLED_RUNTIME_COMPANION';
    packaged_locator: string;
    resolver_mode: 'EXPLICIT_BUNDLED_LOCATOR';
    system_path_fallback: false;
    external_os_prerequisite_allowlist: string[];
  };
  artifact_approval: {
    status: 'NOT_YET_APPROVED' | 'PROVENANCE_VERIFIED' | 'DISTRIBUTION_APPROVED';
  };
  license_evidence: {
    evidence_id: string;
    evidence_sha256: string;
    policy_disposition:
      | 'NOT_EVALUATED'
      | 'SEPARATE_REVIEW_REQUIRED'
      | 'ALLOW_WITH_CONDITIONS'
      | 'BLOCKED';
  };
  retention: {
    transport_role: 'TRANSIENT_TRANSFER_ONLY';
    final_retention_channel: 'MAC_LOCAL_PROJECT_FOLDER';
    recovery_drill_required: true;
  };
};

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const sourceCommit = 'a'.repeat(40);
const sourceArchiveSha = digest('ffmpeg-archive');
const recipeSha = digest('recipe-bytes');
const environmentSha = digest('environment-bytes');
const contextSha = digest('context-bytes');
const temporaryRoots: string[] = [];

function finalize(manifest: CompanionManifest): CompanionManifest {
  const result = structuredClone(manifest);
  result.companion_identity_sha256 = companionIdentityHash(result);
  result.manifest_sha256 = manifestHash(result);
  return result;
}

function baseManifest(os: 'linux' | 'windows', architecture: 'x86_64' | 'arm64' = 'x86_64') {
  const executable = os === 'windows' ? 'bin/companion.exe' : 'bin/companion';
  const library = os === 'windows' ? 'lib/codec.dll' : 'lib/libcodec.so';
  return finalize({
    schema_version: '1',
    subject_type: 'NATIVE_RUNTIME_COMPANION_BUNDLE',
    companion_id: `companion-${os}-${architecture}`,
    manifest_sha256: '0'.repeat(64),
    companion_identity_sha256: '0'.repeat(64),
    role: 'PRODUCT_RUNTIME_DEPENDENCY',
    platform: { os, architecture },
    entrypoint: { path: executable, sha256: digest(`${os}-entrypoint`) },
    bundle_members: [
      { path: executable, sha256: digest(`${os}-entrypoint`), kind: 'EXECUTABLE' },
      { path: library, sha256: digest(`${os}-library`), kind: 'DYNAMIC_LIBRARY' },
    ],
    runtime_dependency_closure: {
      status: 'PASS',
      loader_policy: 'COMPANION_BUNDLE_ONLY',
      undeclared_runtime_resolution: 'FAIL_CLOSED',
      unresolved_count: 0,
      members: [
        {
          name: library.split('/').at(-1),
          classification: 'INTERNAL_COMPANION_MEMBER',
          member_path: library,
          loader_scope: 'COMPANION_BUNDLE_ONLY',
        },
      ],
      external_os_prerequisites: [],
    },
    provenance: {
      upstream_project: 'FFmpeg',
      upstream_release: '8.0.1',
      upstream_tag: 'n8.0.1',
      upstream_commit: sourceCommit,
      source_archive_identity: 'ffmpeg-release-8.0.1.tar.xz',
      source_archive_sha256: sourceArchiveSha,
      build_recipe_id: `ffprobe-recipe-${os}-v1`,
      build_recipe_sha256: recipeSha,
      build_environment_descriptor_id: `github-${os}-2026-09`,
      build_environment_descriptor_sha256: environmentSha,
      build_context_id: `ffprobe-context-${os}-v1`,
      build_context_sha256: contextSha,
      target_platform: os,
      target_architecture: architecture,
    },
    build_configuration: {
      configure_arguments: ['--disable-everything', '--enable-demuxer=mov'],
      build_arguments: ['-j2'],
      compiler_identity: os === 'windows' ? 'msvc-19.44' : 'gcc-13.3.0',
      toolchain_identity: os === 'windows' ? 'vs2022-17.14' : 'ubuntu-24.04-gcc',
      enabled_components: ['ffprobe', 'mov-demuxer'],
      disabled_components: ['network'],
      external_linked_libraries: [],
      linkage: 'SHARED',
      feature_selection: ['media-probe-json'],
    },
    distribution: {
      mode: 'BUNDLED_RUNTIME_COMPANION',
      packaged_locator: executable,
      resolver_mode: 'EXPLICIT_BUNDLED_LOCATOR',
      system_path_fallback: false,
      external_os_prerequisite_allowlist: [],
    },
    artifact_approval: { status: 'PROVENANCE_VERIFIED' },
    license_evidence: {
      evidence_id: `license-evidence-${os}-v1`,
      evidence_sha256: digest(`license-${os}`),
      policy_disposition: 'NOT_EVALUATED',
    },
    retention: {
      transport_role: 'TRANSIENT_TRANSFER_ONLY',
      final_retention_channel: 'MAC_LOCAL_PROJECT_FOLDER',
      recovery_drill_required: true,
    },
  });
}

function materialize(manifest: CompanionManifest) {
  const root = mkdtempSync(join(tmpdir(), 'native-runtime-companion-'));
  temporaryRoots.push(root);
  for (const member of manifest.bundle_members) {
    const path = join(root, member.path);
    mkdirSync(join(path, '..'), { recursive: true });
    if (member.kind === 'SYMLINK') symlinkSync(member.link_target, path);
    else
      writeFileSync(
        path,
        member.path.includes('codec')
          ? `${manifest.platform.os}-library`
          : `${manifest.platform.os}-entrypoint`,
      );
  }
  return root;
}

function expectedFor(manifest: CompanionManifest) {
  return {
    expectedSourceBinding: manifest.provenance,
    expectedBuildRecipe: {
      id: manifest.provenance.build_recipe_id,
      sha256: manifest.provenance.build_recipe_sha256,
    },
    expectedEnvironmentDescriptor: {
      id: manifest.provenance.build_environment_descriptor_id,
      sha256: manifest.provenance.build_environment_descriptor_sha256,
    },
    expectedBuildContext: {
      id: manifest.provenance.build_context_id,
      sha256: manifest.provenance.build_context_sha256,
    },
    expectedBuildConfiguration: manifest.build_configuration,
    expectedPlatform: manifest.platform,
  };
}

function verify(manifest: CompanionManifest, root: string, options: Record<string, unknown> = {}) {
  return verifyCompanionBundle({
    manifest,
    bundleRoot: root,
    resolvedLocator: manifest.distribution.packaged_locator,
    ...expectedFor(manifest),
    ...options,
  });
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('native runtime companion contract', () => {
  it('accepts independently bound Linux and Windows bundles', () => {
    const linux = baseManifest('linux');
    const windows = baseManifest('windows');
    const linuxRoot = materialize(linux);
    const windowsRoot = materialize(windows);
    expect(verify(linux, linuxRoot).status).toBe('PASS');
    expect(verify(windows, windowsRoot).status).toBe('PASS');
    expect(linux.companion_identity_sha256).not.toBe(windows.companion_identity_sha256);
  });

  it('changes bundle identity when runtime semantics change despite identical member bytes', () => {
    const original = baseManifest('linux');
    const changed = structuredClone(original);
    changed.distribution.external_os_prerequisite_allowlist = ['kernel-media-api-v1'];
    changed.runtime_dependency_closure.members.push({
      name: 'kernel-media-api-v1',
      classification: 'EXTERNAL_OS_PREREQUISITE',
    });
    changed.runtime_dependency_closure.external_os_prerequisites.push({
      id: 'kernel-media-api-v1',
      name: 'kernel-media-api-v1',
      version_policy: 'OS_ALLOWLIST_V1',
      allowlisted: true,
    });
    const finalized = finalize(changed);
    expect(finalized.companion_identity_sha256).not.toBe(original.companion_identity_sha256);
    const root = materialize(original);
    expect(verify(finalized, root).status).toBe('PASS');
  });

  it('keeps artifact approval and license evidence as separate records', () => {
    const manifest = baseManifest('linux');
    expect(manifest.artifact_approval).not.toHaveProperty('policy_disposition');
    expect(manifest.license_evidence).not.toHaveProperty('artifact_approval');
    expect(verify(manifest, materialize(manifest)).status).toBe('PASS');
  });

  it('models an explicit allowlisted external OS prerequisite separately', () => {
    const manifest = baseManifest('windows');
    manifest.distribution.external_os_prerequisite_allowlist = ['msvc-v14-x64'];
    manifest.runtime_dependency_closure.members.push({
      name: 'msvc-v14-x64',
      classification: 'EXTERNAL_OS_PREREQUISITE',
    });
    manifest.runtime_dependency_closure.external_os_prerequisites.push({
      id: 'msvc-v14-x64',
      name: 'Microsoft Visual C++ Redistributable 14.x x64',
      version_policy: 'PINNED_PROVIDER_PROBE',
      allowlisted: true,
    });
    const finalized = finalize(manifest);
    expect(verify(finalized, materialize(finalized)).status).toBe('PASS');
  });

  it.each([
    [
      'wrong entrypoint SHA',
      (m: CompanionManifest) => {
        m.entrypoint.sha256 = digest('wrong');
      },
    ],
    [
      'wrong member SHA',
      (m: CompanionManifest) => {
        m.bundle_members[1].sha256 = digest('wrong');
      },
    ],
    [
      'missing member',
      (m: CompanionManifest) => {
        m.bundle_members[1].path = 'lib/missing.so';
      },
    ],
    [
      'wrong platform',
      (m: CompanionManifest) => {
        m.platform.os = 'windows';
      },
    ],
    [
      'wrong architecture',
      (m: CompanionManifest) => {
        m.platform.architecture = 'arm64';
      },
    ],
    [
      'wrong source release binding',
      (m: CompanionManifest) => {
        m.provenance.upstream_release = '9.0.0';
      },
    ],
    [
      'build recipe SHA mismatch',
      (m: CompanionManifest) => {
        m.provenance.build_recipe_sha256 = digest('wrong');
      },
    ],
    [
      'environment descriptor mismatch',
      (m: CompanionManifest) => {
        m.provenance.build_environment_descriptor_id = 'other-env';
      },
    ],
    [
      'build configuration mismatch',
      (m: CompanionManifest) => {
        m.build_configuration.linkage = 'STATIC';
      },
    ],
    [
      'unresolved runtime dependency',
      (m: CompanionManifest) => {
        m.runtime_dependency_closure.unresolved_count = 1;
      },
    ],
    [
      'traversal path',
      (m: CompanionManifest) => {
        m.bundle_members[0].path = '../escape';
      },
    ],
    [
      'absolute member path',
      (m: CompanionManifest) => {
        m.bundle_members[0].path = '/escape';
      },
    ],
    [
      'duplicate normalized member path',
      (m: CompanionManifest) => {
        m.bundle_members[1].path = './bin/companion';
      },
    ],
    [
      'entrypoint outside bundle',
      (m: CompanionManifest) => {
        m.entrypoint.path = 'outside/companion';
      },
    ],
  ])('%s fails closed', (_label, mutate) => {
    const original = baseManifest('linux');
    const changed = structuredClone(original);
    mutate(changed);
    expect(() => verify(changed, materialize(original))).toThrow();
  });

  it('rejects a PATH-resolved executable', () => {
    const manifest = baseManifest('linux');
    expect(() =>
      verify(manifest, materialize(manifest), { resolvedLocator: 'companion' }),
    ).toThrow();
  });

  it('rejects an undeclared packaged member and undeclared dynamic library', () => {
    const manifest = baseManifest('linux');
    const root = materialize(manifest);
    writeFileSync(join(root, 'lib', 'unapproved.so'), 'unapproved');
    expect(() => verify(manifest, root)).toThrow(/undeclared packaged bundle member/);
  });

  it('rejects an undeclared runtime dependency observation', () => {
    const manifest = baseManifest('linux');
    expect(() =>
      verify(manifest, materialize(manifest), { observedRuntimeDependencies: ['libunknown.so'] }),
    ).toThrow();
  });

  it('rejects Windows case collisions and undeclared symlinks', () => {
    const manifest = baseManifest('windows');
    const changed = structuredClone(manifest);
    changed.bundle_members.push({
      path: 'LIB/CODEC.DLL',
      sha256: digest('windows-library'),
      kind: 'DYNAMIC_LIBRARY',
    });
    changed.companion_identity_sha256 = companionIdentityHash(changed);
    changed.manifest_sha256 = manifestHash(changed);
    expect(() => verify(changed, materialize(manifest))).toThrow(/case collision/);

    const root = materialize(manifest);
    symlinkSync('bin/companion.exe', join(root, 'bin', 'unapproved-link.exe'));
    expect(() => verify(manifest, root)).toThrow(/undeclared packaged bundle member/);
  });

  it('rejects an escaped declared link target', () => {
    const manifest = baseManifest('linux');
    manifest.bundle_members.push({
      path: 'lib/link.so',
      sha256: digest('../outside.so'),
      kind: 'SYMLINK',
      link_target: '../outside.so',
    });
    expect(() => verify(manifest, materialize(manifest))).toThrow();
  });

  it('does not require an artifact build or a Python inventory subject', () => {
    const manifest = baseManifest('linux');
    expect(manifest.subject_type).toBe('NATIVE_RUNTIME_COMPANION_BUNDLE');
    expect(existsSync(join(materialize(manifest), 'python-artifact-inventory'))).toBe(false);
  });

  it('keeps the published QICR record byte-bound', () => {
    const recordPath = join(
      process.cwd(),
      'compliance/runtime-dependency-intake/native-runtime-companion-v1/QICR_RECORD_V1.json',
    );
    const sidecarPath = `${recordPath.slice(0, -'.json'.length)}.sha256`;
    const recordBytes = readFileSync(recordPath);
    const recordedSha = readFileSync(sidecarPath, 'utf8').trim().split(/\s+/u)[0];
    expect(digest(recordBytes.toString())).toBe(recordedSha);
    const record = JSON.parse(recordBytes.toString());
    expect(record.decision_status).toBe('PASS');
    expect(record.runtime_companion_subject_type).toBe('NATIVE_RUNTIME_COMPANION_BUNDLE');
  });
});
