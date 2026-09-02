/**
 * Contract: P4 Expert + Skill + Project injection (WorkBuddy alignment).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FleetDaemon } from '../src/daemon.js';
import { SkillLoader, parseSkillMarkdown } from '../src/skillLoader.js';
import { injectProjectContext } from '../src/projectConfigStore.js';

describe('P4 Expert / Skill / Project', () => {
  it('parseSkillMarkdown extracts frontmatter tools whitelist', () => {
    const raw = `---
name: Competitor Scan
description: Scan rivals
tools: bash, read, write
---
# Body`;
    const { frontmatter, body } = parseSkillMarkdown(raw);
    assert.equal(frontmatter.name, 'Competitor Scan');
    assert.deepEqual(frontmatter.tools, ['bash', 'read', 'write']);
    assert.match(body, /# Body/);
  });

  it('SkillLoader loads hive/skills/<id>/SKILL.md', () => {
    const hiveDir = mkdtempSync(join(tmpdir(), 'fleet-skill-'));
    const skillDir = join(hiveDir, 'skills', 'competitor');
    mkdirSync(join(skillDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: Competitor
tools: read
---
Analyze competitors`
    );
    writeFileSync(join(skillDir, 'scripts', 'run.sh'), '#!/bin/sh\necho ok');
    const loader = new SkillLoader(hiveDir);
    const skills = loader.reload();
    assert.equal(skills.length, 1);
    assert.equal(skills[0]?.id, 'competitor');
    assert.deepEqual(skills[0]?.toolWhitelist, ['read']);
    assert.equal(skills[0]?.scripts.length, 1);
  });

  it('injectProjectContext merges global instructions + memory into task', () => {
    const task = injectProjectContext(
      {
        id: 't1',
        title: 'Report',
        status: 'todo',
        dependsOn: [],
        priority: 0,
        createdAt: new Date().toISOString()
      },
      {
        projectId: 'p1',
        globalInstructions: 'Use corporate tone',
        defaultExperts: ['analyst'],
        defaultSkills: ['competitor'],
        defaultConnectors: ['docs'],
        updatedAt: new Date().toISOString()
      },
      ['[memory:style] bullet-first']
    );
    assert.match(task.description ?? '', /Use corporate tone/);
    assert.match(task.description ?? '', /bullet-first/);
    assert.equal(task.expertId, 'analyst');
    assert.deepEqual(task.skillIds, ['competitor']);
    assert.deepEqual(task.connectorIds, ['docs']);
  });

  it('addTask applies project + expert defaults', async () => {
    const home = mkdtempSync(join(tmpdir(), 'fleet-p4-'));
    const daemon = new FleetDaemon({ hiveHome: home, enableHooks: false });
    await daemon.startAsync();
    daemon.updateProjectConfig({
      globalInstructions: 'Team standard: cite sources',
      defaultSkills: ['competitor']
    });
    daemon.upsertExpert({
      id: 'analyst',
      name: 'Analyst',
      positioning: 'Research',
      methodology: 'Evidence first',
      defaultSkills: ['competitor'],
      defaultConnectors: [],
      slotId: 'w1'
    });
    const skillDir = join(home, 'hive', 'skills', 'competitor');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: Competitor\ntools: read\n---\n');
    daemon.reloadSkills();

    const task = daemon.addTask({
      id: 'parent',
      title: 'Market scan',
      status: 'todo',
      dependsOn: [],
      priority: 1,
      createdAt: new Date().toISOString(),
      expertId: 'analyst'
    });
    assert.match(task.description ?? '', /cite sources/);
    assert.equal(task.assignee, 'w1');
    assert.deepEqual(task.skillIds, ['competitor']);
    daemon.stop();
  });
});
