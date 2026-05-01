import { Hono } from 'hono';
import { store } from '../store/store';

export const runners = new Hono();

runners.get('/', (c) => c.json({ items: store.runners.list() }));
