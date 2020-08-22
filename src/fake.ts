import faker from "faker";
import { getRandomInt } from './utils'

interface GetMessagesParams {
  min: number;
  max: number;
}

export const getRandomMessageContent = () =>
  Math.random() > 0.5
    ? faker.lorem.paragraphs(Math.ceil(Math.random() * 2))
    : faker.lorem.words(Math.ceil(Math.random() * 10));

export const getMessages = ({ min, max }: GetMessagesParams) => {
  const count = getRandomInt(min, max);

  return new Array(count).fill(null).map(() => ({
    id: faker.random.uuid(),
    fullName: faker.name.findName(),
    avatarSrc: faker.internet.avatar(),
    content: getRandomMessageContent(),
    date: faker.date.past(),
  }));
};
