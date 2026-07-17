import { describe, expect, it } from 'vitest';

import { createDeterministicIdFactory, createIdFactory } from '../idFactory.ts';

describe('createIdFactory', () => {
  it('mints unique ids across many calls', () => {
    const ids = new Set<string>();
    const factory = createIdFactory();
    for (let i = 0; i < 20_000; i += 1) ids.add(factory.node());
    expect(ids.size).toBe(20_000);
  });

  /**
   * The regression this whole module exists to prevent. The prototype used
   * `"node-" + Date.now()`, which returns the SAME id for every node created
   * within a millisecond — i.e. reliably, whenever a component template inserts
   * several nodes at once.
   */
  it('does not collide when called in a tight loop within one millisecond', () => {
    const factory = createIdFactory();
    const start = Date.now();
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i += 1) ids.add(factory.node());
    // Guard the guard: if this loop somehow spanned many ms, the test is weaker
    // than it claims, so assert it really was a tight burst.
    expect(Date.now() - start).toBeLessThan(50);
    expect(ids.size).toBe(1000);
  });

  it('produces ids that are safe to concatenate into a CSS identifier', () => {
    const factory = createIdFactory();
    for (let i = 0; i < 2000; i += 1) {
      expect(factory.node()).toMatch(/^[0-9A-Za-z]{12}$/);
    }
  });

  it('draws distinct ids for distinct kinds', () => {
    const factory = createIdFactory();
    const ids = [
      factory.node(),
      factory.page(),
      factory.project(),
      factory.styleRule(),
      factory.breakpoint(),
      factory.token(),
      factory.asset(),
      factory.component(),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('accepts an injected generator', () => {
    let n = 0;
    const factory = createIdFactory(() => `fixed${(n += 1)}`);
    expect(factory.node()).toBe('fixed1');
    expect(factory.page()).toBe('fixed2');
  });
});

describe('createDeterministicIdFactory', () => {
  it('counts per kind, so ids are readable in failure output', () => {
    const factory = createDeterministicIdFactory();
    expect(factory.node()).toBe('node-1');
    expect(factory.node()).toBe('node-2');
    expect(factory.page()).toBe('page-1');
    expect(factory.styleRule()).toBe('rule-1');
    expect(factory.node()).toBe('node-3');
  });

  it('two factories are independent, so tests cannot leak into each other', () => {
    const a = createDeterministicIdFactory();
    const b = createDeterministicIdFactory();
    a.node();
    a.node();
    expect(b.node()).toBe('node-1');
  });

  it('is reproducible: identical call sequences yield identical ids', () => {
    const run = () => {
      const factory = createDeterministicIdFactory();
      return [factory.node(), factory.node(), factory.page()];
    };
    expect(run()).toEqual(run());
  });
});
