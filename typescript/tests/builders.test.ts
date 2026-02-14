import { describe, it, expect } from 'vitest';
import { MemoryBuilder, RecallBuilder } from '../src/builders';

describe('MemoryBuilder', () => {
  it('should build basic memory', () => {
    const memory = new MemoryBuilder()
      .content('Test memory')
      .build();

    expect(memory.content).toBe('Test memory');
  });

  it('should build full memory', () => {
    const memory = new MemoryBuilder()
      .content('User prefers dark mode')
      .importance(0.9)
      .tags(['preferences', 'ui'])
      .namespace('app-settings')
      .memoryType('preference')
      .pinned(true)
      .build();

    expect(memory.content).toBe('User prefers dark mode');
    expect(memory.importance).toBe(0.9);
    expect(memory.tags).toEqual(['preferences', 'ui']);
    expect(memory.namespace).toBe('app-settings');
    expect(memory.memory_type).toBe('preference');
    expect(memory.pinned).toBe(true);
  });

  it('should add tags incrementally', () => {
    const memory = new MemoryBuilder()
      .content('Test')
      .addTag('tag1')
      .addTag('tag2')
      .build();

    expect(memory.tags).toEqual(['tag1', 'tag2']);
  });

  it('should add metadata incrementally', () => {
    const memory = new MemoryBuilder()
      .content('Test')
      .addMetadata('key1', 'value1')
      .addMetadata('key2', 42)
      .build();

    expect(memory.metadata).toEqual({ key1: 'value1', key2: 42 });
  });

  it('should set metadata directly', () => {
    const memory = new MemoryBuilder()
      .content('Test')
      .metadata({ custom: 'data' })
      .build();

    expect(memory.metadata).toEqual({ custom: 'data' });
  });

  it('should set expires in days', () => {
    const memory = new MemoryBuilder()
      .content('Test')
      .expiresInDays(7)
      .build();

    expect(memory.expires_at).toBeDefined();
    expect(memory.expires_at?.endsWith('Z')).toBe(true);
  });

  it('should throw on invalid importance', () => {
    expect(() => {
      new MemoryBuilder().content('Test').importance(1.5);
    }).toThrow('between 0.0 and 1.0');
  });

  it('should throw on missing content', () => {
    expect(() => {
      new MemoryBuilder().build();
    }).toThrow('content is required');
  });
});

describe('RecallBuilder', () => {
  it('should build basic recall', () => {
    const params = new RecallBuilder()
      .query('search term')
      .build();

    expect(params).toEqual({ query: 'search term' });
  });

  it('should build full recall', () => {
    const params = new RecallBuilder()
      .query('dark mode preferences')
      .limit(10)
      .minSimilarity(0.7)
      .namespace('app-settings')
      .session('sess-123')
      .agent('agent-456')
      .includeRelations(true)
      .build();

    expect(params.query).toBe('dark mode preferences');
    expect(params.limit).toBe(10);
    expect(params.min_similarity).toBe(0.7);
    expect(params.namespace).toBe('app-settings');
    expect(params.session_id).toBe('sess-123');
    expect(params.agent_id).toBe('agent-456');
    expect(params.include_relations).toBe(true);
  });

  it('should build recall with tags filter', () => {
    const params = new RecallBuilder()
      .query('test')
      .tags(['tag1', 'tag2'])
      .build();

    expect(params.filters?.tags).toEqual(['tag1', 'tag2']);
  });

  it('should build recall with memory type filter', () => {
    const params = new RecallBuilder()
      .query('test')
      .memoryType('preference')
      .build();

    expect(params.filters?.memory_type).toBe('preference');
  });

  it('should throw on missing query', () => {
    expect(() => {
      new RecallBuilder().build();
    }).toThrow('query is required');
  });

  it('should throw on invalid minSimilarity', () => {
    expect(() => {
      new RecallBuilder().query('test').minSimilarity(1.1);
    }).toThrow('between 0.0 and 1.0');
  });
});
