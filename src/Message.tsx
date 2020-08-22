import { Avatar, Comment, Button } from "antd";
import moment from "moment";
import React, { useState } from "react";
import { getRandomMessageContent } from "./fake";

export interface MessageProps {
  id: string;
  fullName: string;
  avatarSrc: string;
  content: string;
  date: Date;
}

export const Message: React.FC<MessageProps> = React.memo(function ({
  id,
  fullName,
  avatarSrc,
  content,
  date,
}) {
  const [newContent, setNewContent] = useState("");
  const actions = [
    <Button
      type="text"
      onClick={() => {
        setNewContent(getRandomMessageContent());
      }}
    >
      Edit content
    </Button>,
  ];

  return (
    <Comment
      actions={actions}
      author={<a href={`#/${fullName}/${id}`}>{fullName}</a>}
      avatar={<Avatar src={avatarSrc} alt={fullName} />}
      content={
        <>
          <p>{newContent || content}</p>
          {id}
        </>
      }
      datetime={<span>{moment(date).calendar()}</span>}
    />
  );
});
