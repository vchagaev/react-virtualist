import faker from "faker";

export const getRandomMessageContent = () =>
  Math.random() > 0.5
    ? faker.lorem.paragraphs(Math.ceil(Math.random() * 2))
    : faker.lorem.words(Math.ceil(Math.random() * 10));
