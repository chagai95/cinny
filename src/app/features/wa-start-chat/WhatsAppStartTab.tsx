import React, { useState } from 'react';
import { Icon, Icons } from 'folds';
import { SidebarAvatar, SidebarItem, SidebarItemTooltip } from '../../components/sidebar';
import { StartWhatsAppChatDialog } from './StartWhatsAppChatDialog';

/**
 * Sidebar rail button that opens the "Start WhatsApp chat" dialog.
 *
 * Placed in the sidebar next to Direct Messages (a natural "new chat / DM
 * action" spot). Follows the same SidebarItem + SidebarAvatar + tooltip pattern
 * as the other rail buttons (Direct, Create, Explore …).
 */
export function WhatsAppStartTab() {
  const [open, setOpen] = useState(false);

  return (
    <SidebarItem>
      <SidebarItemTooltip tooltip="Start WhatsApp chat">
        {(triggerRef) => (
          <SidebarAvatar as="button" ref={triggerRef} outlined onClick={() => setOpen(true)}>
            <Icon src={Icons.Phone} />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {open && <StartWhatsAppChatDialog requestClose={() => setOpen(false)} />}
    </SidebarItem>
  );
}
