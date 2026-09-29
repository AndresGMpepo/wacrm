// ============================================================
// Write MCP tools for the in-app HTTP endpoint — registered only
// when the calling API key carries the matching write scope.
// ============================================================

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { hasScope } from '@/lib/api-keys/scopes';
import { callRoute } from '../bridge';
import { handle, jsonResult } from './shared';

import { POST as sendMessagePOST } from '@/app/api/v1/messages/route';
import { POST as createContactPOST } from '@/app/api/v1/contacts/route';
import { PATCH as updateContactPATCH } from '@/app/api/v1/contacts/[id]/route';
import { PATCH as assignConversationPATCH } from '@/app/api/v1/conversations/[id]/assignment/route';
import { POST as addConversationNotePOST } from '@/app/api/v1/conversations/[id]/internal-notes/route';

const templateSchema = z
  .object({
    name: z.string().describe('Meta-approved template name.'),
    language: z.string().describe('Template language code, e.g. "en_US".'),
    params: z.array(z.string()).optional().describe('Positional body variables, in order.'),
  })
  .describe('Template payload — required when type is "template".');

export function registerWriteTools(server: McpServer, authHeader: string, scopes: string[]): void {
  if (hasScope(scopes, 'messages:send')) {
    server.registerTool(
      'send_message',
      {
        title: 'Send WhatsApp message',
        description:
          'Send a WhatsApp message to a phone number (E.164, e.g. +14155550123). The contact and conversation are found-or-created automatically. Use type "text" for a free-form message (only valid inside the 24-hour customer-service window), or "template" to send an approved template (required to open a new conversation). Media types (image/video/document/audio) require a media_url. This sends a real message to a real person — confirm the recipient and content with the user before calling.',
        inputSchema: {
          to: z.string().describe('Recipient phone number in E.164 format, e.g. +14155550123.'),
          type: z
            .enum(['text', 'template', 'image', 'video', 'document', 'audio'])
            .default('text')
            .describe('Message type. Defaults to "text".'),
          text: z.string().optional().describe('Message body for "text", or the caption for a media type.'),
          media_url: z.string().url().optional().describe('Publicly reachable URL of the media file (required for media types).'),
          filename: z.string().optional().describe('File name for a "document" send.'),
          template: templateSchema.optional(),
          reply_to_message_id: z.string().optional().describe('Optional id of a message in the same conversation to reply to.'),
        },
        annotations: { title: 'Send WhatsApp message', readOnlyHint: false, openWorldHint: true },
      },
      handle(async (args: Record<string, unknown>) =>
        jsonResult((await callRoute(sendMessagePOST, '/messages', authHeader, { body: args })).data),
      ),
    );
  }

  if (hasScope(scopes, 'contacts:write')) {
    server.registerTool(
      'create_contact',
      {
        title: 'Create contact',
        description:
          'Create a contact by phone number (E.164, required). Find-or-create: if a contact with that phone already exists it is returned unchanged. Optional: name, email, company, and tags (tag names, created if missing).',
        inputSchema: {
          phone: z.string().describe('Phone number in E.164 format, e.g. +14155550123.'),
          name: z.string().optional(),
          email: z.string().email().optional(),
          company: z.string().optional(),
          tags: z.array(z.string()).optional().describe('Tag names; created if they do not exist.'),
        },
        annotations: { title: 'Create contact', readOnlyHint: false, openWorldHint: true },
      },
      handle(async (args: Record<string, unknown>) =>
        jsonResult((await callRoute(createContactPOST, '/contacts', authHeader, { body: args })).data),
      ),
    );

    server.registerTool(
      'update_contact',
      {
        title: 'Update contact',
        description:
          "Update an existing contact. Only the fields you pass are changed. Pass tags (an array of tag names) to replace the contact's tags entirely.",
        inputSchema: {
          id: z.string().describe('Contact id.'),
          name: z.string().optional(),
          email: z.string().email().optional(),
          company: z.string().optional(),
          tags: z.array(z.string()).optional().describe("Replaces the contact's tags."),
        },
        annotations: { title: 'Update contact', readOnlyHint: false, openWorldHint: true },
      },
      handle(async ({ id, ...body }: { id: string } & Record<string, unknown>) =>
        jsonResult((await callRoute(updateContactPATCH, `/contacts/${id}`, authHeader, { method: 'PATCH', body, params: { id } })).data),
      ),
    );
  }

  if (hasScope(scopes, 'conversations:assign')) {
    server.registerTool(
      'assign_conversation',
      {
        title: 'Assign conversation',
        description:
          'Assign a conversation to an active team member, or remove its assignment. Never sends a customer message and never changes the conversation status. Call list_team_members first to resolve a name to a user_id.',
        inputSchema: {
          id: z.string().describe('Conversation id.'),
          assigned_agent_id: z.string().nullable().describe('Team member user_id from list_team_members, or null to unassign.'),
        },
        annotations: { title: 'Assign conversation', readOnlyHint: false, openWorldHint: true },
      },
      handle(async ({ id, assigned_agent_id }: { id: string; assigned_agent_id: string | null }) =>
        jsonResult(
          (
            await callRoute(assignConversationPATCH, `/conversations/${id}/assignment`, authHeader, {
              method: 'PATCH',
              body: { assigned_agent_id },
              params: { id },
            })
          ).data,
        ),
      ),
    );
  }

  if (hasScope(scopes, 'conversation-notes:write')) {
    server.registerTool(
      'add_conversation_note',
      {
        title: 'Add internal note',
        description:
          'Add a private team note to a conversation. Never delivered to the customer through WhatsApp, Meta, Yeastar, or web chat — visible only inside the NexoOmni inbox.',
        inputSchema: {
          id: z.string().describe('Conversation id.'),
          body: z.string().min(1).describe('Note text.'),
        },
        annotations: { title: 'Add internal note', readOnlyHint: false, openWorldHint: true },
      },
      handle(async ({ id, body }: { id: string; body: string }) =>
        jsonResult(
          (
            await callRoute(addConversationNotePOST, `/conversations/${id}/internal-notes`, authHeader, {
              body: { body },
              params: { id },
            })
          ).data,
        ),
      ),
    );
  }
}
