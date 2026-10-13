// Event names and routes kept in constants, the way larger codebases do.
export const COLLAB_EVENTS = {
  JOIN: 'file:collab:join',
  LEAVE: 'file:collab:leave',
} as const;

// Not `as const`: still statically known.
export const PRESENCE = { PING: 'presence:ping' };

export enum ChatEvent {
  Send = 'chat:send',
}

const NS = 'realtime';
export const NAMESPACE = `/${NS}`;
export const TYPING = 'chat:' + 'typing';

export const ROUTES = { USERS: 'users', PROJECTS: 'projects' } as const;
