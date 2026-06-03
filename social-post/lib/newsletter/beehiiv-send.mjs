export async function send(draft, { client, human_confirm } = {}) {
  if (human_confirm !== 'human_confirm') throw new Error('human_confirm required');
  if (!client || typeof client.humanSend !== 'function') throw new Error('beehiiv client required');
  return client.humanSend(draft);
}
