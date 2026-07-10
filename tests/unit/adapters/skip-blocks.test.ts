import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { filterSkipBlocks, validateSkipBlocks, loadCase } from '../../../src/adapters/yaml-loader.js';

describe('use_step selective skip blocks (skip_blocks)', () => {
  const scriptWithBlocks = `
open "/page"
# @skip_block first_submit_probe
tap "Submit"
assert_exists "Success"
# @skip_block first_submit_probe
tap "Next"
# @skip_block
tap "Optional"
# @skip_block
done
  `.trim();

  describe('filterSkipBlocks direct tests', () => {
    it('should keep all lines if skipBlocksVal is undefined/false', () => {
      const result = filterSkipBlocks(scriptWithBlocks, undefined);
      expect(result).not.toContain('# @skip_block');
      expect(result).toContain('tap "Submit"');
      expect(result).toContain('tap "Optional"');
    });

    it('should skip all blocks if skipBlocksVal is true', () => {
      const result = filterSkipBlocks(scriptWithBlocks, true);
      expect(result).not.toContain('tap "Submit"');
      expect(result).not.toContain('tap "Optional"');
      expect(result).toContain('open "/page"');
      expect(result).toContain('tap "Next"');
      expect(result).toContain('done');
    });

    it('should skip only named block if skipBlocksVal is array of names', () => {
      const result = filterSkipBlocks(scriptWithBlocks, ['first_submit_probe']);
      expect(result).not.toContain('tap "Submit"');
      expect(result).toContain('tap "Optional"'); // Unnamed block is kept
      expect(result).toContain('open "/page"');
      expect(result).toContain('tap "Next"');
      expect(result).toContain('done');
    });

    it('should throw error if block is not closed', () => {
      const invalidScript = `
open "/page"
# @skip_block unclosed
tap "Submit"
      `.trim();
      expect(() => filterSkipBlocks(invalidScript, true)).toThrow('Block parsing error');
    });
  });

  describe('validateSkipBlocks tests', () => {
    it('should pass on valid script with matching blocks', () => {
      expect(() => validateSkipBlocks(scriptWithBlocks, 'fake-case.yaml')).not.toThrow();
    });

    it('should throw descriptive error on unclosed block', () => {
      const invalidScript = `
# @skip_block named_block
tap "A"
      `.trim();
      expect(() => validateSkipBlocks(invalidScript, 'test.yaml')).toThrow(
        '[yaml-loader] Error in "test.yaml": "# @skip_block" block "named_block" starting at line 1 has no matching end marker.'
      );
    });
  });

  describe('loadCase Integration tests', () => {
    const tempCasePath = path.resolve('tests/unit/adapters/temp-skip-blocks-case.yaml');

    afterEach(() => {
      if (fs.existsSync(tempCasePath)) {
        fs.unlinkSync(tempCasePath);
      }
    });

    it('should correctly filter scripts on loadCase with skip_blocks', () => {
      const yamlContent = `
name: temp-case
roles:
  guest: {}
steps:
  - id: step_base
    role: guest
    script: |
      open "/page"
      # @skip_block optional_section
      tap "Submit"
      # @skip_block optional_section
      tap "Next"
  - id: step_reuse
    use_step: step_base
    skip_blocks: true
      `.trim();

      fs.writeFileSync(tempCasePath, yamlContent, 'utf8');
      const loaded = loadCase(tempCasePath);
      
      const stepBase = loaded.steps.find(s => s.id === 'step_base');
      const stepReuse = loaded.steps.find(s => s.id === 'step_reuse');

      expect(stepBase).toBeDefined();
      expect(stepBase!.script).toContain('tap "Submit"'); // Original step has it

      expect(stepReuse).toBeDefined();
      expect(stepReuse!.script).not.toContain('tap "Submit"'); // Reused step skipped it
      expect(stepReuse!.script).toContain('open "/page"');
      expect(stepReuse!.script).toContain('tap "Next"');
    });
  });
});
