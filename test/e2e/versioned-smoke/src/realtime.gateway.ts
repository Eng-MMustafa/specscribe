import { MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ChatEvent, COLLAB_EVENTS, NAMESPACE, PRESENCE, TYPING } from './events';
import { COLLAB_EVENTS as EV } from './events';

const LOCAL = 'room:local';

@WebSocketGateway({ namespace: NAMESPACE })
export class RealtimeGateway {
  /** Subscribe to a project's updates. */
  @SubscribeMessage('project:subscribe')
  subscribe(@MessageBody() projectId: string) {
    return { ok: true, projectId };
  }

  /** Join a file's collaboration session. */
  @SubscribeMessage(COLLAB_EVENTS.JOIN)
  join(@MessageBody() body: { fileId: string }) {
    return { joined: body.fileId };
  }

  @SubscribeMessage(EV['LEAVE'])
  leave() {
    return { left: true };
  }

  @SubscribeMessage(PRESENCE.PING)
  ping() {
    return 'pong';
  }

  @SubscribeMessage(ChatEvent.Send)
  send(@MessageBody() text: string) {
    return { text };
  }

  @SubscribeMessage(TYPING)
  typing() {
    return true;
  }

  @SubscribeMessage(`${LOCAL}:enter`)
  enter() {
    return true;
  }
}
