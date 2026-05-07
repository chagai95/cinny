import React, { useState } from 'react';
import { Icon, Icons } from 'folds';
import { SidebarItem, SidebarItemTooltip, SidebarAvatar } from '../../../components/sidebar';
import { Settings, SettingsPages } from '../../../features/settings';
import { Modal500 } from '../../../components/Modal500';

export function SignatureTab() {
  const [open, setOpen] = useState(false);

  return (
    <SidebarItem active={open}>
      <SidebarItemTooltip tooltip="Signature">
        {(triggerRef) => (
          <SidebarAvatar as="button" ref={triggerRef} onClick={() => setOpen(true)}>
            <Icon src={Icons.Pencil} size="400" />
          </SidebarAvatar>
        )}
      </SidebarItemTooltip>
      {open && (
        <Modal500 requestClose={() => setOpen(false)}>
          <Settings initialPage={SettingsPages.SignaturePage} requestClose={() => setOpen(false)} />
        </Modal500>
      )}
    </SidebarItem>
  );
}
