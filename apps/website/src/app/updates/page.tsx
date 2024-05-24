import ContactForm from "@/components/ContactForm";
import { Tag } from "@/components/Tag";
import { getBlogPosts } from "@/lib/blog";
import type { Metadata } from "next";
import { MDXRemote } from "next-mdx-remote/rsc";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "CarbonOS | Updates",
};

export function UpdatesHeader() {
  return (
    <div className="py-24  w-screen flex flex-col items-center space-y-8 ">
      <h1 className="text-3xl font-semibold sm:text-2xl lg:text-4xl xl:text-5xl">
        Updates
      </h1>
      <p className="text-center text-muted-foreground text-lg">
        Subscribe to learn about new features, and updates in Carbon.
      </p>
      <ContactForm />
    </div>
  );
}

export default function Page() {
  const data = getBlogPosts();
  const posts = data
    .sort((a, b) => {
      if (new Date(a.metadata.publishedAt) > new Date(b.metadata.publishedAt)) {
        return -1;
      }
      return 1;
    })
    .map((post, index) => (
      <Article key={post.slug} data={post} firstPost={index === 0} />
    ));

  return (
    <div className="container flex flex-col items-center scroll-smooth">
      <UpdatesHeader />
      <div className="max-w-[680px] pt-[80px] w-full">{posts}</div>
    </div>
  );
}

type ArticleProps = {
  firstPost: boolean;
  data: {
    slug: string;
    metadata: {
      tag: string;
      title: string;
      image?: string;
      publishedAt?: string;
      link?: string;
    };
    content: string;
  };
};

export function Article({ data }: ArticleProps) {
  const formattedDate = data?.metadata?.publishedAt
    ? new Date(data.metadata.publishedAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  return (
    <article
      key={data.slug}
      className="flex max-w-[750px] flex-col items-start pt-28 mb-20 -mt-28"
      id={data.slug}
    >
      <Tag status={data.metadata.tag} />
      <Link className="block " href={`/updates/${data.slug}`}>
        <h2 className="font-medium text-3xl ">{data.metadata.title}</h2>
        <div className="text-muted-foreground">{formattedDate}</div>
      </Link>
      {data.metadata.image &&
        (data.metadata.link ? (
          <Link href={data.metadata.link}>
            <Image
              src={data.metadata.image}
              alt={data.metadata.title}
              width={680}
              height={442}
              className="my-8 cusor-pointer"
            />
          </Link>
        ) : (
          <Image
            src={data.metadata.image}
            alt={data.metadata.title}
            width={680}
            height={442}
            className="my-8"
          />
        ))}
      <div>
        <div className="prose prose-lg dark:prose-invert">
          <MDXRemote source={data.content} />
        </div>
      </div>
    </article>
  );
}
