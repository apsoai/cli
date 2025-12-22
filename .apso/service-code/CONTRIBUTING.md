# Contributing to APSO Service Template

We love your input! We want to make contributing to APSO Service Template as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## We Develop with Github
We use GitHub to host code, to track issues and feature requests, as well as accept pull requests.

## We Use [Github Flow](https://guides.github.com/introduction/flow/index.html)
Pull requests are the best way to propose changes to the codebase. We actively welcome your pull requests:

1. Fork the repo and create your branch from `main`.
2. If you've added code that should be tested, add tests.
3. If you've changed APIs, update the documentation.
4. Ensure the test suite passes.
5. Make sure your code lints.
6. Issue that pull request!

## Any contributions you make will be under the MIT Software License
In short, when you submit code changes, your submissions are understood to be under the same [MIT License](http://choosealicense.com/licenses/mit/) that covers the project. Feel free to contact the maintainers if that's a concern.

## Report bugs using Github's [issue tracker](https://github.com/your-org/apso-service-template/issues)
We use GitHub issues to track public bugs. Report a bug by [opening a new issue](https://github.com/your-org/apso-service-template/issues/new); it's that easy!

## Write bug reports with detail, background, and sample code

**Great Bug Reports** tend to have:

- A quick summary and/or background
- Steps to reproduce
  - Be specific!
  - Give sample code if you can.
- What you expected would happen
- What actually happens
- Notes (possibly including why you think this might be happening, or stuff you tried that didn't work)

## Development Process

1. Clone the repository
2. Create a new branch for your feature/fix
3. Install dependencies: `npm install`
4. Make your changes
5. Run tests: `npm test`
6. Run linting: `npm run lint`
7. Submit a pull request

### Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification. This leads to more readable messages that are easy to follow when looking through the project history.

Example commit messages:

- feat(api): add new endpoint for user registration
- fix(db): resolve connection pooling issue
- docs(readme): update installation instructions
- style(lint): fix linting errors
- refactor(auth): simplify authentication logic

## Code Style

- We use ESLint and Prettier for code formatting
- Follow the existing code style
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions small and focused
- Follow SOLID principles and Domain-Driven Design practices

## Testing

- Write unit tests for new features
- Update existing tests when modifying features
- Aim for high test coverage
- Use meaningful test descriptions

## Documentation

- Update README.md with any new features
- Document all public APIs
- Include JSDoc comments for TypeScript code
- Update OpenAPI/Swagger documentation for REST endpoints
- Update GraphQL schema documentation

## License
By contributing, you agree that your contributions will be licensed under its MIT License. 