import React, { MouseEventHandler, ReactNode } from 'react';
import { IconSrc, Icons } from 'folds';
import { MatrixEvent } from 'matrix-js-sdk';
import { IMemberContent, Membership } from '../../types/matrix/room';
import { getMxIdLocalPart } from '../utils/matrix';
import { isMembershipChanged } from '../utils/room';

export type ParsedResult = {
  icon: IconSrc;
  body: ReactNode;
};

export type MemberEventParser = (
  mEvent: MatrixEvent,
  onUserClick?: MouseEventHandler<HTMLButtonElement>
) => ParsedResult;

export const useMemberEventParser = (): MemberEventParser => {
  const parseMemberEvent: MemberEventParser = (mEvent, onUserClick) => {
    // Names are clickable (open the profile) and carry no ID tooltip.
    const nm = (id: string, name: string): ReactNode =>
      onUserClick ? (
        <b>
          <button
            type="button"
            data-user-id={id}
            onClick={onUserClick}
            style={{
              all: 'unset',
              cursor: 'pointer',
              fontWeight: 'inherit',
              textDecoration: 'none',
            }}
          >
            {name}
          </button>
        </b>
      ) : (
        <b>{name}</b>
      );
    const content = mEvent.getContent<IMemberContent>();
    const prevContent = mEvent.getPrevContent() as IMemberContent;
    const senderId = mEvent.getSender();
    const userId = mEvent.getStateKey();
    const reason = typeof content.reason === 'string' ? content.reason : undefined;

    if (!senderId || !userId)
      return {
        icon: Icons.User,
        body: 'Broken membership event',
      };

    const senderName = getMxIdLocalPart(senderId);
    const userName =
      typeof content.displayname === 'string'
        ? content.displayname || getMxIdLocalPart(userId)
        : getMxIdLocalPart(userId);

    if (isMembershipChanged(mEvent)) {
      if (content.membership === Membership.Invite) {
        if (prevContent.membership === Membership.Knock) {
          return {
            icon: Icons.ArrowGoRightPlus,
            body: (
              <>
                {nm(senderId, senderName)}
                {' accepted '}
                {nm(userId, userName)}
                {`'s join request `}
                {reason}
              </>
            ),
          };
        }

        return {
          icon: Icons.ArrowGoRightPlus,
          body: (
            <>
              {nm(senderId, senderName)}
              {' invited '}
              {nm(userId, userName)} {reason}
            </>
          ),
        };
      }

      if (content.membership === Membership.Knock) {
        return {
          icon: Icons.ArrowGoRightPlus,
          body: (
            <>
              {nm(userId, userName)}
              {' request to join room '}
              {reason}
            </>
          ),
        };
      }

      if (content.membership === Membership.Join) {
        return {
          icon: Icons.ArrowGoRight,
          body: (
            <>
              {nm(userId, userName)}
              {' joined the room'}
            </>
          ),
        };
      }

      if (content.membership === Membership.Leave) {
        if (prevContent.membership === Membership.Invite) {
          return {
            icon: Icons.ArrowGoRightCross,
            body:
              senderId === userId ? (
                <>
                  {nm(userId, userName)}
                  {' rejected the invitation '}
                  {reason}
                </>
              ) : (
                <>
                  {nm(senderId, senderName)}
                  {' rejected '}
                  {nm(userId, userName)}
                  {`'s join request `}
                  {reason}
                </>
              ),
          };
        }

        if (prevContent.membership === Membership.Knock) {
          return {
            icon: Icons.ArrowGoRightCross,
            body:
              senderId === userId ? (
                <>
                  {nm(userId, userName)}
                  {' revoked joined request '}
                  {reason}
                </>
              ) : (
                <>
                  {nm(senderId, senderName)}
                  {' revoked '}
                  {nm(userId, userName)}
                  {`'s invite `}
                  {reason}
                </>
              ),
          };
        }

        if (prevContent.membership === Membership.Ban) {
          return {
            icon: Icons.ArrowGoLeft,
            body: (
              <>
                {nm(senderId, senderName)}
                {' unbanned '}
                {nm(userId, userName)} {reason}
              </>
            ),
          };
        }

        return {
          icon: Icons.ArrowGoLeft,
          body:
            senderId === userId ? (
              <>
                {nm(userId, userName)}
                {' left the room '}
                {reason}
              </>
            ) : (
              <>
                {nm(senderId, senderName)}
                {' kicked '}
                {nm(userId, userName)} {reason}
              </>
            ),
        };
      }

      if (content.membership === Membership.Ban) {
        return {
          icon: Icons.ArrowGoLeft,
          body: (
            <>
              {nm(senderId, senderName)}
              {' banned '}
              {nm(userId, userName)} {reason}
            </>
          ),
        };
      }
    }

    if (content.displayname !== prevContent.displayname) {
      const prevUserName =
        typeof prevContent.displayname === 'string'
          ? prevContent.displayname || getMxIdLocalPart(userId)
          : getMxIdLocalPart(userId);

      return {
        icon: Icons.Mention,
        body:
          typeof content.displayname === 'string' ? (
            <>
              {nm(userId, prevUserName)}
              {' changed display name to '}
              {nm(userId, userName)}
            </>
          ) : (
            <>
              {nm(userId, prevUserName)}
              {' removed their display name '}
            </>
          ),
      };
    }
    if (content.avatar_url !== prevContent.avatar_url) {
      return {
        icon: Icons.User,
        body:
          content.avatar_url && typeof content.avatar_url === 'string' ? (
            <>
              {nm(userId, userName)}
              {' changed their avatar'}
            </>
          ) : (
            <>
              {nm(userId, userName)}
              {' removed their avatar '}
            </>
          ),
      };
    }

    return {
      icon: Icons.User,
      body: 'Membership event with no changes',
    };
  };

  return parseMemberEvent;
};
